using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Windows.Media.Control;
using Windows.Media;
using Windows.Foundation;
using Windows.Storage.Streams;

internal sealed class SmtcPayload
{
    public bool HasSession { get; set; }
    public string? NoSessionReason { get; set; }
    public bool IsMusicEligible { get; set; }
    public string? VideoId { get; set; }
    public string? Title { get; set; }
    public string? Artist { get; set; }
    public string? Album { get; set; }
    public double ElapsedSeconds { get; set; }
    public double SongDuration { get; set; }
    public bool IsPaused { get; set; }
    public string? ImageSrc { get; set; }
    public string? SourceAppUserModelId { get; set; }
    public long SampledAtMs { get; set; }
    public string? Error { get; set; }
}

internal static class Program
{
    private static readonly Dictionary<string, string> CoverCache = new(StringComparer.Ordinal);
    private static readonly int MinArtworkDimensionPx = ResolveMinArtworkDimension();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
    private static readonly TimeSpan PlayingPollInterval = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan IdlePollInterval = TimeSpan.FromMilliseconds(1000);

    private sealed class SessionSnapshot
    {
        public required GlobalSystemMediaTransportControlsSession Session { get; init; }
        public required GlobalSystemMediaTransportControlsSessionMediaProperties MediaProperties { get; init; }
        public required GlobalSystemMediaTransportControlsSessionPlaybackInfo PlaybackInfo { get; init; }
        public required GlobalSystemMediaTransportControlsSessionTimelineProperties Timeline { get; init; }
        public required GlobalSystemMediaTransportControlsSessionPlaybackStatus PlaybackStatus { get; init; }
        public required MediaPlaybackType? MediaPlaybackType { get; init; }
        public required MediaPlaybackType? SessionPlaybackType { get; init; }
    }

    [STAThread]
    private static async Task<int> Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Error.WriteLine("[SMTC-HELPER] Starting");
        Console.Error.Flush();

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        try
        {
            while (!cts.IsCancellationRequested)
            {
                GlobalSystemMediaTransportControlsSessionManager manager;
                try
                {
                    manager = await RequestManagerWithTimeoutAsync(cts.Token);
                }
                catch (Exception ex)
                {
                    WritePayload(new SmtcPayload { Error = $"RequestAsync failed: {ex.Message}" });
                    await Task.Delay(1000, cts.Token);
                    continue;
                }

                Console.Error.WriteLine("[SMTC-HELPER] Session manager acquired");
                Console.Error.Flush();
                await LoopAsync(manager, cts.Token);
            }
            return 0;
        }
        catch (Exception ex)
        {
            WritePayload(new SmtcPayload { Error = ex.Message });
            return 1;
        }
    }

    private static async Task LoopAsync(GlobalSystemMediaTransportControlsSessionManager manager, CancellationToken ct)
    {
        using var signal = new AsyncPulseSignal();
        TypedEventHandler<GlobalSystemMediaTransportControlsSessionManager, CurrentSessionChangedEventArgs>? currentSessionChanged = (_, _) => signal.Pulse();
        TypedEventHandler<GlobalSystemMediaTransportControlsSessionManager, SessionsChangedEventArgs>? sessionsChanged = (_, _) => signal.Pulse();
        manager.CurrentSessionChanged += currentSessionChanged;
        manager.SessionsChanged += sessionsChanged;

        GlobalSystemMediaTransportControlsSession? observedSession = null;
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, TimelinePropertiesChangedEventArgs>? timelineChanged = null;
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, PlaybackInfoChangedEventArgs>? playbackChanged = null;
        TypedEventHandler<GlobalSystemMediaTransportControlsSession, MediaPropertiesChangedEventArgs>? mediaChanged = null;

        void DetachObservedSession()
        {
            if (observedSession is null) return;
            if (timelineChanged is not null) observedSession.TimelinePropertiesChanged -= timelineChanged;
            if (playbackChanged is not null) observedSession.PlaybackInfoChanged -= playbackChanged;
            if (mediaChanged is not null) observedSession.MediaPropertiesChanged -= mediaChanged;
            observedSession = null;
            timelineChanged = null;
            playbackChanged = null;
            mediaChanged = null;
        }

        void AttachObservedSession(GlobalSystemMediaTransportControlsSession? session)
        {
            if (ReferenceEquals(observedSession, session)) return;
            DetachObservedSession();
            if (session is null) return;

            observedSession = session;
            timelineChanged = (_, _) => signal.Pulse();
            playbackChanged = (_, _) => signal.Pulse();
            mediaChanged = (_, _) => signal.Pulse();
            observedSession.TimelinePropertiesChanged += timelineChanged;
            observedSession.PlaybackInfoChanged += playbackChanged;
            observedSession.MediaPropertiesChanged += mediaChanged;
        }

        try
        {
            while (!ct.IsCancellationRequested)
            {
                var selection = await SelectBestSessionAsync(manager);
                var snapshot = selection.Snapshot;
                AttachObservedSession(snapshot?.Session);

                var nextDelay = IdlePollInterval;
                if (snapshot is null)
                {
                    WritePayload(new SmtcPayload
                    {
                        HasSession = false,
                        NoSessionReason = selection.Reason,
                        SampledAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    });
                    await signal.WaitAsync(nextDelay, ct);
                    continue;
                }

                try
                {
                    var info = snapshot.MediaProperties;
                    var timeline = snapshot.Timeline;
                    var playback = snapshot.PlaybackInfo;
                    var isMusicEligible = IsMusicEligibleSession(snapshot);

                    var title = (info?.Title ?? string.Empty).Trim();
                    var artist = (info?.Artist ?? string.Empty).Trim();
                    var album = (info?.AlbumTitle ?? string.Empty).Trim();
                    var sourceApp = (snapshot.Session.SourceAppUserModelId ?? string.Empty).Trim();
                    var videoId = StableVideoId(title, artist, album, sourceApp);

                    var playbackStatus = snapshot.PlaybackStatus;
                    var isPaused = playbackStatus != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                    nextDelay = isPaused ? IdlePollInterval : PlayingPollInterval;

                    var duration = timeline?.EndTime.TotalSeconds ?? 0.0;
                    var elapsed = GetElapsedSeconds(timeline, playbackStatus);
                    var sampledAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                    var isBrowserSession = IsBrowserSession(sourceApp.ToLowerInvariant());
                    var cachedImageSrc = string.Empty;
                    if (!isBrowserSession && CoverCache.TryGetValue(videoId, out var cached))
                    {
                        cachedImageSrc = cached;
                    }

                    // Always re-read the current SMTC thumbnail first. Some players update
                    // title/artist before artwork, and cache-first behavior can lock in the
                    // previous song's cover for the whole track.
                    var liveImageSrc = await ReadThumbnailDataUrlAsync(info?.Thumbnail);
                    var imageSrc = !string.IsNullOrEmpty(liveImageSrc) ? liveImageSrc : cachedImageSrc;
                    if (!string.IsNullOrEmpty(liveImageSrc))
                    {
                        CoverCache[videoId] = liveImageSrc;
                    }

                    WritePayload(new SmtcPayload
                    {
                        HasSession = true,
                        IsMusicEligible = isMusicEligible,
                        VideoId = videoId,
                        Title = title,
                        Artist = artist,
                        Album = album,
                        ElapsedSeconds = elapsed,
                        SongDuration = duration,
                        IsPaused = isPaused,
                        ImageSrc = imageSrc,
                        SourceAppUserModelId = sourceApp,
                        SampledAtMs = sampledAtMs,
                        Error = null
                    });
                }
                catch (Exception ex)
                {
                    WritePayload(new SmtcPayload { Error = ex.Message, SampledAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() });
                }

                await signal.WaitAsync(nextDelay, ct);
            }
        }
        finally
        {
            DetachObservedSession();
            manager.CurrentSessionChanged -= currentSessionChanged;
            manager.SessionsChanged -= sessionsChanged;
        }
    }

    private static double GetElapsedSeconds(
        GlobalSystemMediaTransportControlsSessionTimelineProperties? timeline,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus playbackStatus)
    {
        var elapsed = timeline?.Position.TotalSeconds ?? 0.0;
        var duration = timeline?.EndTime.TotalSeconds ?? 0.0;

        if (timeline is not null
            && playbackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing
            && timeline.LastUpdatedTime != default)
        {
            var drift = DateTimeOffset.UtcNow - timeline.LastUpdatedTime;
            if (drift.TotalMilliseconds > 0)
            {
                elapsed += drift.TotalSeconds;
            }
        }

        if (duration > 0)
        {
            elapsed = Math.Min(duration, elapsed);
        }

        return Math.Max(0, elapsed);
    }

    private static async Task<GlobalSystemMediaTransportControlsSessionManager> RequestManagerWithTimeoutAsync(CancellationToken ct)
    {
        var op = GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var waitedMs = 0;
        while (op.Status == AsyncStatus.Started && waitedMs < 5000)
        {
            await Task.Delay(100, ct);
            waitedMs += 100;
        }

        return op.Status switch
        {
            AsyncStatus.Completed => op.GetResults(),
            AsyncStatus.Error => throw op.ErrorCode ?? new InvalidOperationException("Unknown WinRT error"),
            AsyncStatus.Canceled => throw new OperationCanceledException("SMTC manager request cancelled"),
            AsyncStatus.Started => throw new TimeoutException("Timed out waiting for SMTC manager"),
            _ => throw new InvalidOperationException($"Unknown async status: {op.Status}")
        };
    }

    private sealed class SessionSelection
    {
        public SessionSnapshot? Snapshot { get; init; }
        public string Reason { get; init; } = "no_sessions";
    }

    private const int PlayingSessionRank = 300;
    private const int PausedSessionRank = 200;
    private const int StoppedSessionRank = 150;
    private const int OpenedSessionRank = 100;
    private const int UnknownSessionRank = 50;

    private static async Task<SessionSelection> SelectBestSessionAsync(GlobalSystemMediaTransportControlsSessionManager manager)
    {
        var current = manager.GetCurrentSession();
        var sessions = manager.GetSessions();
        if ((current is null) && (sessions is null || sessions.Count == 0))
        {
            return new SessionSelection { Snapshot = null, Reason = "no_sessions" };
        }

        var candidates = new List<GlobalSystemMediaTransportControlsSession>();
        if (current is not null)
        {
            candidates.Add(current);
        }
        if (sessions is not null)
        {
            foreach (var session in sessions)
            {
                if (current is not null && ReferenceEquals(session, current))
                {
                    continue;
                }
                candidates.Add(session);
            }
        }

        SessionSnapshot? best = null;
        var bestRank = int.MinValue;
        var sawAnySession = false;
        var sawPlayingSession = false;
        var sawMusicTypedSession = false;
        foreach (var session in candidates)
        {
            sawAnySession = true;
            var snapshot = await TryCaptureSessionSnapshotAsync(session);
            if (snapshot is null) continue;

            if (snapshot.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
            {
                sawPlayingSession = true;
            }
            if (IsMusicEligibleSession(snapshot))
            {
                sawMusicTypedSession = true;
            }

            var rank = RankSession(snapshot);
            if (rank <= int.MinValue) continue;

            if (best is null || rank > bestRank)
            {
                best = snapshot;
                bestRank = rank;
            }
        }

        if (best is not null)
        {
            return new SessionSelection { Snapshot = best, Reason = "selected" };
        }

        var reason = sawPlayingSession
            ? (sawMusicTypedSession ? "blocked_music_candidate" : "non_music_playing")
            : (sawAnySession ? "no_playing_session" : "no_sessions");

        return new SessionSelection
        {
            Snapshot = null,
            Reason = reason
        };
    }

    private static async Task<SessionSnapshot?> TryCaptureSessionSnapshotAsync(GlobalSystemMediaTransportControlsSession session)
    {
        try
        {
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();
            var media = await session.TryGetMediaPropertiesAsync();
            if (playback is null || timeline is null || media is null)
            {
                return null;
            }
            var playbackStatus = playback!.PlaybackStatus;
            var sessionPlaybackType = playback.PlaybackType;
            var mediaPlaybackType = media!.PlaybackType;

            return new SessionSnapshot
            {
                Session = session,
                MediaProperties = media!,
                PlaybackInfo = playback!,
                Timeline = timeline!,
                PlaybackStatus = playbackStatus,
                MediaPlaybackType = mediaPlaybackType,
                SessionPlaybackType = sessionPlaybackType
            };
        }
        catch
        {
            return null;
        }
    }

    private static int RankSession(SessionSnapshot snapshot)
    {
        if (!IsMusicEligibleSession(snapshot)) return int.MinValue;
        if (!HasTrackIdentity(snapshot.MediaProperties)) return int.MinValue;

        return snapshot.PlaybackStatus switch
        {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => PlayingSessionRank,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => PausedSessionRank,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Stopped => StoppedSessionRank,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Opened => OpenedSessionRank,
            _ => UnknownSessionRank
        };
    }

    /// <summary>
    /// A session is eligible for music if:
    ///   - Neither type field is explicitly Video or Image (hard exclude).
    ///   - At least one type field is Music, OR both are null/Unknown
    ///     (many native players never set SessionPlaybackType).
    ///
    /// This replaces the old AND-both-must-be-Music check which was
    /// blocking Spotify desktop, foobar2000, MusicBee, and others that
    /// only populate MediaPlaybackType.
    ///
    /// YouTube/Twitter video sessions are caught here because browsers
    /// report their video sessions with MediaPlaybackType = Video.
    /// Pure browser audio sessions that declare no type at all (Unknown/null
    /// on both) are allowed through — they're filtered downstream by
    /// IsLikelyVideoMetadata if they also lack proper music metadata.
    /// </summary>
    // Browser process name fragments (lower-case) used to identify browser sessions.
    private static readonly string[] BrowserAppHints =
    [
        "chrome", "msedge", "firefox", "opera", "brave", "vivaldi", "iexplore", "browser"
    ];

    // Music tracks are almost always between 30 s and 60 min.
    private const double MinMusicDurationSeconds = 30.0;
    private const double MaxMusicDurationSeconds = 3600.0;

    // Aspect ratio tolerance for "square-ish" artwork.
    // A 1:1 square has ratio 1.0. We reject anything wider than this threshold
    // (e.g. 16:9 = 1.78, which is clearly a video thumbnail).
    private const double MaxSquareAspectRatio = 1.4;

    private static bool IsMusicEligibleSession(SessionSnapshot snapshot)
    {
        var mediaType = snapshot.MediaPlaybackType;
        var sessionType = snapshot.SessionPlaybackType;

        // Hard exclude: explicit Video or Image declaration on either field.
        if (mediaType == MediaPlaybackType.Video || mediaType == MediaPlaybackType.Image) return false;
        if (sessionType == MediaPlaybackType.Video || sessionType == MediaPlaybackType.Image) return false;

        // Require at least one field to say Music, OR both null/Unknown.
        var hasMusicType = mediaType == MediaPlaybackType.Music || sessionType == MediaPlaybackType.Music;
        var bothAmbiguous = mediaType != MediaPlaybackType.Music && sessionType != MediaPlaybackType.Music;

        if (!hasMusicType && !bothAmbiguous) return false;

        // For browser sessions, run additional heuristics regardless of whether
        // the type field said Music. Browsers report Music for all audio
        // including video, so the type alone is not trustworthy.
        var sourceApp = (snapshot.Session.SourceAppUserModelId ?? string.Empty).ToLowerInvariant();
        if (IsBrowserSession(sourceApp))
        {
            return PassesBrowserMusicHeuristics(snapshot);
        }

        // Native apps with ambiguous types: check metadata as a last resort.
        if (bothAmbiguous)
        {
            return !IsLikelyVideoMetadata(snapshot.MediaProperties);
        }

        // Native app with explicit Music type: trust it fully.
        return true;
    }

    private static bool IsBrowserSession(string sourceAppLower)
    {
        foreach (var hint in BrowserAppHints)
        {
            if (sourceAppLower.Contains(hint, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    /// <summary>
    /// All checks that run for browser sessions. A session must pass every
    /// one of these to be considered music. Checks are ordered cheapest first.
    ///
    ///  1. Track identity  — require both title and artist.
    ///  2. Duration        — music tracks are 30 s – 60 min. Short clips and
    ///                       long streams/movies fall outside this range.
    ///                       Skipped when duration is unreported (0).
    ///  3. Cover present   — a music session must have artwork.
    ///  4. Aspect ratio    — artwork must be square-ish (≤ 1.4 : 1).
    ///                       Video thumbnails are 16:9 ≈ 1.78.
    ///  5. Album metadata  — optional positive signal, but no longer required
    ///                       because some browser music apps omit it in SMTC.
    /// </summary>
    private static bool PassesBrowserMusicHeuristics(SessionSnapshot snapshot)
    {
        var props = snapshot.MediaProperties;

        // 1. Track identity
        if (!HasTrackIdentity(props)) return false;

        // 2. Duration (only when the timeline reports a non-zero value)
        var duration = snapshot.Timeline?.EndTime.TotalSeconds ?? 0.0;
        if (duration > 0)
        {
            if (duration < MinMusicDurationSeconds) return false;
            if (duration > MaxMusicDurationSeconds) return false;
        }

        // 3 & 4. Cover presence and aspect ratio
        if (props?.Thumbnail is null) return false;
        if (!TryGetCoverAspectRatio(props.Thumbnail, out var ratio)) return false;
        if (ratio > MaxSquareAspectRatio) return false;

        // 5. Album metadata remains a useful positive signal, but absence alone
        // should not disqualify browser music sessions like YouTube Music.
        return true;
    }

    /// <summary>
    /// Returns true when the session metadata looks like a video page:
    /// has a title and artist but none of the album-layer fields.
    /// </summary>
    private static bool IsLikelyVideoMetadata(GlobalSystemMediaTransportControlsSessionMediaProperties? media)
    {
        if (media is null) return false;
        if (string.IsNullOrWhiteSpace(media.Title) || string.IsNullOrWhiteSpace(media.Artist)) return false;

        var hasAlbum = !string.IsNullOrWhiteSpace(media.AlbumTitle);
        var hasAlbumArtist = !string.IsNullOrWhiteSpace(media.AlbumArtist);
        var hasTrackCount = media.AlbumTrackCount > 0;

        return !hasAlbum && !hasAlbumArtist && !hasTrackCount;
    }

    /// <summary>
    /// Synchronously reads enough of the thumbnail stream to determine
    /// image dimensions, then computes width/height aspect ratio.
    /// Returns false if the thumbnail cannot be read or decoded.
    /// </summary>
    private static bool TryGetCoverAspectRatio(IRandomAccessStreamReference thumbnail, out double ratio)
    {
        ratio = 0;
        try
        {
            // Open the stream synchronously via AsTask to avoid making the
            // eligibility check async (which would complicate the call sites).
            var streamTask = thumbnail.OpenReadAsync().AsTask();
            streamTask.Wait(500); // 500 ms cap — don't stall the loop
            if (!streamTask.IsCompletedSuccessfully) return false;

            using var stream = streamTask.Result;
            if (stream is null || stream.Size == 0) return false;

            // Read only the first 64 bytes — enough for PNG/JPEG/WebP/GIF headers.
            var headerSize = (uint)Math.Min(64, stream.Size);
            using var reader = new DataReader(stream);
            reader.LoadAsync(headerSize).AsTask().Wait(200);
            var header = new byte[headerSize];
            reader.ReadBytes(header);

            if (!TryGetImageDimensions(header, out var w, out var h)) return false;
            if (h == 0) return false;

            ratio = (double)w / h;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool IsMusicPlaybackType(MediaPlaybackType? playbackType)
    {
        return playbackType == MediaPlaybackType.Music;
    }

    private static bool HasTrackIdentity(GlobalSystemMediaTransportControlsSessionMediaProperties media)
    {
        return !string.IsNullOrWhiteSpace(media?.Title)
            && !string.IsNullOrWhiteSpace(media?.Artist);
    }

    private static string StableVideoId(string title, string artist, string album, string sourceApp)
    {
        var raw = $"{sourceApp}\n{title}\n{artist}\n{album}";
        var bytes = Encoding.UTF8.GetBytes(raw);
        var hash = SHA1.HashData(bytes);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static async Task<string> ReadThumbnailDataUrlAsync(IRandomAccessStreamReference? thumbnail)
    {
        if (thumbnail is null) return string.Empty;

        using var stream = await thumbnail.OpenReadAsync();
        if (stream is null || stream.Size <= 0) return string.Empty;

        using var reader = new DataReader(stream);
        await reader.LoadAsync((uint)stream.Size);
        var buffer = new byte[stream.Size];
        reader.ReadBytes(buffer);
        // Keep small artwork instead of dropping it outright.
        // Some SMTC sources (especially browser sessions) expose thumbnails below 64px.
        if (!IsUsableArtwork(buffer))
        {
            // Continue anyway; dimension checks are only advisory.
        }

        var mime = DetectMime(buffer);
        var b64 = Convert.ToBase64String(buffer);
        return $"data:{mime};base64,{b64}";
    }

    private static bool IsUsableArtwork(byte[] data)
    {
        if (data.Length == 0) return false;
        if (!TryGetImageDimensions(data, out var width, out var height)) return true;
        return width >= MinArtworkDimensionPx && height >= MinArtworkDimensionPx;
    }

    private static int ResolveMinArtworkDimension()
    {
        // Allow tuning without code changes. Default is permissive to avoid false negatives.
        var raw = Environment.GetEnvironmentVariable("SMTC_MIN_ARTWORK_PX");
        if (int.TryParse(raw, out var parsed))
        {
            return Math.Clamp(parsed, 16, 512);
        }
        return 64;
    }

    private static string DetectMime(byte[] data)
    {
        if (data.Length >= 8
            && data[0] == 0x89 && data[1] == 0x50 && data[2] == 0x4E && data[3] == 0x47
            && data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A)
        {
            return "image/png";
        }
        if (data.Length >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF)
        {
            return "image/jpeg";
        }
        if (data.Length >= 6
            && data[0] == 0x47 && data[1] == 0x49 && data[2] == 0x46
            && data[3] == 0x38 && (data[4] == 0x37 || data[4] == 0x39) && data[5] == 0x61)
        {
            return "image/gif";
        }
        if (data.Length >= 12
            && data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46
            && data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50)
        {
            return "image/webp";
        }
        return "image/jpeg";
    }

    private static bool TryGetImageDimensions(byte[] data, out int width, out int height)
    {
        width = 0;
        height = 0;

        var mime = DetectMime(data);
        if (mime == "image/png")
        {
            if (data.Length < 24) return false;
            width = (data[16] << 24) | (data[17] << 16) | (data[18] << 8) | data[19];
            height = (data[20] << 24) | (data[21] << 16) | (data[22] << 8) | data[23];
            return width > 0 && height > 0;
        }

        if (mime == "image/gif")
        {
            if (data.Length < 10) return false;
            width = data[6] | (data[7] << 8);
            height = data[8] | (data[9] << 8);
            return width > 0 && height > 0;
        }

        if (mime == "image/jpeg")
        {
            if (data.Length < 4 || data[0] != 0xFF || data[1] != 0xD8) return false;
            var i = 2;
            while (i + 8 < data.Length)
            {
                if (data[i] != 0xFF)
                {
                    i += 1;
                    continue;
                }

                var marker = data[i + 1];
                if (marker == 0xD8 || marker == 0xD9)
                {
                    i += 2;
                    continue;
                }

                if (i + 3 >= data.Length) return false;
                var segmentLength = (data[i + 2] << 8) | data[i + 3];
                if (segmentLength < 2 || i + 2 + segmentLength > data.Length) return false;

                var isStartOfFrame =
                    (marker >= 0xC0 && marker <= 0xC3) ||
                    (marker >= 0xC5 && marker <= 0xC7) ||
                    (marker >= 0xC9 && marker <= 0xCB) ||
                    (marker >= 0xCD && marker <= 0xCF);

                if (isStartOfFrame)
                {
                    height = (data[i + 5] << 8) | data[i + 6];
                    width = (data[i + 7] << 8) | data[i + 8];
                    return width > 0 && height > 0;
                }

                i += 2 + segmentLength;
            }

            return false;
        }

        if (mime == "image/webp")
        {
            if (data.Length < 30) return false;
            if (!(data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46)) return false;
            if (!(data[8] == 0x57 && data[9] == 0x45 && data[10] == 0x42 && data[11] == 0x50)) return false;

            if (data[12] == 0x56 && data[13] == 0x50 && data[14] == 0x38 && data[15] == 0x58)
            {
                width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
                height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
                return width > 0 && height > 0;
            }

            if (data[12] == 0x56 && data[13] == 0x50 && data[14] == 0x38 && data[15] == 0x4C)
            {
                if (data.Length < 25) return false;
                var bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
                width = (bits & 0x3FFF) + 1;
                height = ((bits >> 14) & 0x3FFF) + 1;
                return width > 0 && height > 0;
            }
        }

        return false;
    }

    private static void WritePayload(SmtcPayload payload)
    {
        Console.WriteLine(JsonSerializer.Serialize(payload, JsonOptions));
        Console.Out.Flush();
    }
}

internal sealed class AsyncPulseSignal : IDisposable
{
    private TaskCompletionSource<bool> _signal = CreateSignal();

    public void Pulse()
    {
        var prior = Interlocked.Exchange(ref _signal, CreateSignal());
        prior.TrySetResult(true);
    }

    public async Task WaitAsync(TimeSpan timeout, CancellationToken ct)
    {
        var signal = Volatile.Read(ref _signal).Task;
        var delay = Task.Delay(timeout, ct);
        await Task.WhenAny(signal, delay);
        ct.ThrowIfCancellationRequested();
    }

    public void Dispose()
    {
        Pulse();
    }

    private static TaskCompletionSource<bool> CreateSignal()
    {
        return new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    }
}
