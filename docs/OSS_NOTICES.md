# OSS Notices

Lumen VPN Android v1 is built as an OSS-compatible Android client and includes third-party components that must be reviewed before public distribution.

- Hiddify Core Android library (`hiddify-core.aar`) from `hiddify/hiddify-core`, used as the primary sing-box-compatible runtime.
- AndroidX Jetpack libraries for Compose, Room, DataStore, CameraX, and Security Crypto.
- OkHttp and kotlinx.serialization for network/API and subscription parsing.
- ML Kit Barcode Scanning for QR import.

Before Play Store or public APK distribution, run a full license audit for the exact dependency graph and include upstream license files in the release package.
