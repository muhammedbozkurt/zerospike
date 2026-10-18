fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios metadata_check

```sh
[bundle exec] fastlane ios metadata_check
```

Metin ve gorsel onizleme (HTML), yukleme yok

### ios metadata_upload

```sh
[bundle exec] fastlane ios metadata_upload
```

Metin ve gorselleri yukler; binary ve review yok

----


## Android

### android validate

```sh
[bundle exec] fastlane android validate
```

Play metadata dogrulama, yukleme yok

### android upload

```sh
[bundle exec] fastlane android upload
```

Play metadata yukleme; binary yok

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
