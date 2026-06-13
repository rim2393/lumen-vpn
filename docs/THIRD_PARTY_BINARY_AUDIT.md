# Third-Party Binary Audit

Date: 2026-06-13

Purpose: track every committed binary/runtime data artifact that affects
open-source redistribution. The repository license is AGPL-3.0-or-later, but
redistributed third-party binaries keep their own upstream notice obligations.

## Summary

- Repository-level license: AGPL-3.0-or-later.
- Public GitHub license detection: AGPL-3.0 after canonical `LICENSE` text.
- No product license server, billing gate, payment integration, or node-count
  license limit remains in the public code path.
- Release blocker: exact upstream version/commit provenance is still required
  for the committed Android runtime binaries before publishing binary releases.

## Binary Inventory

| SHA256 | Path | Probable component | Upstream/license action |
| --- | --- | --- | --- |
| `8bc1ce38bca2dd3e13022a4457336602490f2e7d063626a0192d89209a49d07e` | `app/libs/hiddify-core.aar` | Hiddify Core | Pin exact upstream tag/commit from `hiddify/hiddify-core`; preserve GPL-3.0-or-later notice and source link. |
| `f83e89edfd3b35acbbbb862a4c88a8ca3e1ddce4d298cc617be79bdaa23a0672` | `app/src/main/assets/geoip.dat` | Xray/V2Ray GeoIP data | Pin exact data source/release; preserve GeoIP/data license notices. |
| `f329656f27a1dac1971e1dff9aed2d7a60029d087e1216b2536c1e86ebe82ca3` | `app/src/main/assets/geosite.dat` | Xray/V2Ray geosite data | Pin exact data source/release; preserve domain-list/geosite license notices. |
| `259e897588d798546fb5721eec1983c98a6a46358a5fa864b170d95c7d77fec3` | `app/src/main/jniLibs/arm64-v8a/libc++_shared.so` | Android NDK libc++ | Preserve Android/LLVM runtime notices. |
| `668bf3a894cf5014c9a7fcbc8403b3cd6301ab8f2fdd7d5c3d03f41678463037` | `app/src/main/jniLibs/arm64-v8a/libck-ovpn-plugin.so` | Cloak plugin | Pin exact source/release from `cbeuw/Cloak`; preserve GPL-3.0 notice. |
| `9bfa36f727ae451fcba9dccafee1c27cde5fb9708156f1c2dd4f2ca05a434b49` | `app/src/main/jniLibs/arm64-v8a/libovpn3.so` | OpenVPN 3 | Pin OpenVPN/Amnezia source commit; preserve AGPL-3.0/MPL-2.0 notices. |
| `91707032fe0d5c41466f196ea41ee5a0166997f921b8d24958b668258145ec59` | `app/src/main/jniLibs/arm64-v8a/libovpnutil.so` | OpenVPN 3 utility | Pin OpenVPN/Amnezia source commit; preserve AGPL-3.0/MPL-2.0 notices. |
| `e902f75df1ccc8e0553a949680eff3425ca31925771c48506d30933d21276e16` | `app/src/main/jniLibs/arm64-v8a/librsapss.so` | OpenVPN/OpenSSL helper | Pin source and OpenSSL/crypto notices. |
| `5c34e81ee984ea655622f9cf19b54af826f461cd0e27fb4d0b4d18ce9edf309a` | `app/src/main/jniLibs/arm64-v8a/libtun2socks.so` | tun2socks | Pin exact source/release from `xjasonlyu/tun2socks`; preserve MIT notice. |
| `d3dab5cf776d8619cea6f5317027c2a59004602cffb195dd9acb067038171287` | `app/src/main/jniLibs/arm64-v8a/libxray.so` | Xray Core | Pin exact source/release from `XTLS/Xray-core`; preserve MPL-2.0 notice and source availability. |
| `feed4b1c33b9ed9f3c81b508f561ae117d63703062ca4e47539f4680b035be6a` | `app/src/main/jniLibs/armeabi-v7a/libtun2socks.so` | tun2socks | Same as tun2socks above. |
| `6d7dd52f1663044e0181f159449e558ce66cd232c5fd08b8fba581a9188326b9` | `app/src/main/jniLibs/armeabi-v7a/libxray.so` | Xray Core | Same as Xray above. |
| `86325f713d20aced3658226e8add8bfc74482f221624a6c2c2311c73abe87cd2` | `app/src/main/jniLibs/x86/libck-ovpn-plugin.so` | Cloak plugin | Same as Cloak above. |
| `8b8115603ca4573b5012ddbbe07365f6726252f1c0cfb790e2fb7c5875f68e75` | `app/src/main/jniLibs/x86/libovpn3.so` | OpenVPN 3 | Same as OpenVPN above. |
| `89a45505bdec7ebeca2e128e3d6dd04e47f5837f4b9f0f1000558f2c70e39393` | `app/src/main/jniLibs/x86/libovpnutil.so` | OpenVPN 3 utility | Same as OpenVPN above. |
| `8829a4f42a744694ec7b1044317388597836416e81b789f2de61b3bdd1cab09b` | `app/src/main/jniLibs/x86/librsapss.so` | OpenVPN/OpenSSL helper | Same as OpenVPN/OpenSSL above. |
| `12abdee081e804875fd76b432d2854b02faf57d7bd28af9602e7347ae1ec4e9e` | `app/src/main/jniLibs/x86/libtun2socks.so` | tun2socks | Same as tun2socks above. |
| `91968644b45ccb4b1438566061c7f2a85a3241a5665f966243c80a0a2d1f945a` | `app/src/main/jniLibs/x86/libxray.so` | Xray Core | Same as Xray above. |
| `58c182001c00f70c8fcb75fc5340d7393b78136721d6bd520deae134fdac089a` | `app/src/main/jniLibs/x86_64/libck-ovpn-plugin.so` | Cloak plugin | Same as Cloak above. |
| `d2079c9c35dcd2606a0c063ef268f4b867c367cbd5d874a1d0220381fbda6c16` | `app/src/main/jniLibs/x86_64/libovpn3.so` | OpenVPN 3 | Same as OpenVPN above. |
| `f45b686e4262d70e73ee44d6e1538c6235fc87c28a9054f575d5128b8316fcdd` | `app/src/main/jniLibs/x86_64/libovpnutil.so` | OpenVPN 3 utility | Same as OpenVPN above. |
| `e595a6e214b23826912afd58573985f0457ee7eacc5fcff226d416f58e2f2fb0` | `app/src/main/jniLibs/x86_64/librsapss.so` | OpenVPN/OpenSSL helper | Same as OpenVPN/OpenSSL above. |
| `cbf1fe4d4985ed9f66eb93069648f2b2ad19aaf0302373adbf93aff34c3ac730` | `app/src/main/jniLibs/x86_64/libtun2socks.so` | tun2socks | Same as tun2socks above. |
| `9f65dfead7efe30cd3e0cc69a892caff2195c1cc01d767be6c8ed3457f67b31a` | `app/src/main/jniLibs/x86_64/libxray.so` | Xray Core | Same as Xray above. |
| `05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da` | `desktop/packaging/service/LumenVPNService.exe` | WinSW | Preserve MIT notice from `winsw/winsw`; downloaded by `desktop/packaging/fetch-runtime.ps1`. |

## Maintainer Rule

If a binary cannot be mapped to an exact upstream release tag, source commit, or
reproducible local build script, treat it as not release-ready. Keep it out of
published APK/MSI artifacts until provenance is restored.
