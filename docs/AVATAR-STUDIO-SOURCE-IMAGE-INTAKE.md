# Avatar Studio source-image intake contract

Avatar Studio accepts an operator source image only when the declared MIME type, filename extension, detected signature, and real media decode agree. The original bytes are stored as an immutable artifact; intake never generates, edits, or re-encodes a replacement image.

## Supported still-image formats

| Format | Declared MIME | Extensions | Decode contract |
| --- | --- | --- | --- |
| JPEG/JPG | `image/jpeg` | `.jpg`, `.jpeg` | JPEG signature, matching declaration/extension, readable image stream, positive dimensions |
| PNG | `image/png` | `.png` | PNG signature, matching declaration/extension, readable image stream, positive dimensions |
| WebP | `image/webp` | `.webp` | RIFF/WEBP signature, matching declaration/extension, readable VP8/VP8L/VP8X image stream, positive dimensions |

HEIC/HEIF is intentionally unsupported. The Dashboard excludes it from the picker contract and rejects a dragged HEIC/HEIF file before upload with `FORMAT_UNSUPPORTED`. The backend independently detects HEIF-family `ftyp` brands and returns the same class. Browser picker visibility alone is never evidence of support.

GIF, AVIF, TIFF, BMP, and other still-image formats are also unsupported source-image encodings unless this contract and its decoder regression corpus are explicitly extended.

## Recorded bounded analysis

Every accepted intake records the original filename, declared MIME, detected MIME, byte size, decoded width and height, display orientation, safe codec/pixel-format characteristics, metadata parser name/result, Gate 0 status, policy version, and every safe finding. Private EXIF fields and arbitrary compressed bytes are not exposed or coerced to text.

Gate 0 scans only bounded structured inputs: source locator, the safe media summary, explicit provenance, and text extracted from defined JPEG COM/XMP, PNG tEXt/iTXt, or WebP XMP containers. Random compressed/trailing bytes are never scanned as prompts or executable text. Genuine suspicious text in those structured containers remains fail-closed.

## Derived provider output

Provider-generated media is recorded as `DERIVED_PROVIDER_OUTPUT`; the provider is never represented as the human rights owner. The missing-owner review is waived only when typed internal lineage proves an approved provider execution, an eligible Gate 0 PASS source, valid or non-required face consent, the current Identity version and Identity Lock, and a source asset or certified-reference dependency. Missing or stale lineage produces `DERIVED_PROVIDER_LINEAGE_INVALID` and remains in review.

Execution UUIDs and other typed lineage identifiers are validated as fields, not coerced into free text. Gate 0 still scans bounded text-bearing fields such as repair instructions and JPEG COM/XMP, PNG tEXt/iTXt, or WebP XMP. Any genuine security BLOCK remains terminal.

## Readiness and validation classes

The Dashboard reports one of `SOURCE READY`, `REVIEW REQUIRED`, `UNSUPPORTED FORMAT`, `INVALID MEDIA`, `SECURITY BLOCKED`, `QUALITY INSUFFICIENT`, or `PROVENANCE/CONSENT REQUIRED` with a safe explanation. Internally, failures are classified as `MEDIA_INVALID`, `FORMAT_UNSUPPORTED`, `SECURITY_BLOCK`, `SECURITY_FALSE_POSITIVE`, `PROVENANCE_REQUIRED`, `QUALITY_INSUFFICIENT`, or `REVIEW_REQUIRED` rather than a generic upload failure.

Identity-source quality currently requires both decoded edges to be at least 512 pixels. This technical threshold does not certify likeness or suitability; human identity review remains a separate gate.
