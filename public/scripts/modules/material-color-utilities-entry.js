import {
    Hct,
    MaterialDynamicColors,
    SchemeExpressive,
    sourceColorFromImageBytes,
    hexFromArgb,
} from '@material/material-color-utilities';

export async function buildExpressivePaletteFromImage(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error('Cover image has no dimensions');

    // Sample only the centered square visible in the app's cover treatment.
    // 64×64 is enough for palette selection and caps the quantizer at 4,096 pixels.
    const side = Math.min(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Could not create cover sampling canvas');
    context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, 64, 64);

    const pixels = context.getImageData(0, 0, 64, 64).data;
    const imageSource = Hct.fromInt(sourceColorFromImageBytes(pixels));

    // Preserve the cover's hue while keeping chroma and source tone in range.
    // Material color roles set the final tones and foreground/background pairs.
    const source = Hct.from(
        imageSource.hue,
        Math.max(16, Math.min(48, imageSource.chroma)),
        50
    );
    const scheme = new SchemeExpressive(source, true, 0, '2025', 'phone');
    const toHex = role => hexFromArgb(role.getArgb(scheme));
    const colors = MaterialDynamicColors;

    return {
        primary: toHex(colors.primary),
        secondary: toHex(colors.onSurfaceVariant),
        secVar1: toHex(colors.tertiary),
        secVar2: toHex(colors.outline),
        bgTint: toHex(colors.surface),
        onPrimary: toHex(colors.onPrimary)
    };
}
