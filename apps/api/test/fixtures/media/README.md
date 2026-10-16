# HEIC fixtures

These unmodified public samples come from [ianare/exif-samples](https://github.com/ianare/exif-samples), revision `5332a9cf0220e9c6c93f88a187daa90808051e10`.
The upstream README releases contributed images under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). That license applies to these images, independently of application code. Attribution: the exif-samples contributors; individual photographers are not identified in the source directory.

| Local file | Upstream path | Camera recorded in EXIF | SHA-256 |
| --- | --- | --- | --- |
| `iphone-11-pro-max.heic` | `heic/IMG_5195.HEIC` | Apple iPhone 11 Pro Max | `d9b9ebe21c4127080414f2b86f6ecb900dc2ca902be82b39be93b61ccb622680` |
| `iphone-13-pro-max.heic` | `heic/mobile/iphone_13_pro_max.HEIC` | Apple iPhone 13 Pro Max | `e760c80eed310e4f27c092d5487693ca8e104e7cc01d25ba4828deb28f679676` |

Keep the originals intact: the tests need real HEVC, orientation, tiling and metadata. Do not print their EXIF/GPS values or reuse these samples as guest content. Production-container tests upload these fixtures through the API and verify metadata-free JPEG outputs. Synthetic JPEG/PNG/WebP and invalid inputs are generated locally by the other tests.
