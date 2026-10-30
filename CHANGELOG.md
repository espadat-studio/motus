# Changelog

## [1.2.0](https://github.com/espadat-studio/motus/compare/v1.1.0...v1.2.0) (2026-10-30)


### Features

* **matcher:** redact fragments of url-shaped secrets ([#55](https://github.com/espadat-studio/motus/issues/55)) ([e85a33c](https://github.com/espadat-studio/motus/commit/e85a33cfed4a98431e3e4201d2b720811578341a))
* **matcher:** redact truncated and wrapped fragments of secrets ([#53](https://github.com/espadat-studio/motus/issues/53)) ([fabed0c](https://github.com/espadat-studio/motus/commit/fabed0c67371c7e5fb2f6b1cbdefce213010a7ce))

## [1.1.0](https://github.com/espadat-studio/motus/compare/v1.0.0...v1.1.0) (2026-10-30)


### Features

* **mise:** detect age keys in file-task env headers ([#49](https://github.com/espadat-studio/motus/issues/49)) ([f28aafd](https://github.com/espadat-studio/motus/commit/f28aafd00a4bfa491d33c67603328a7abadc5193)), closes [#46](https://github.com/espadat-studio/motus/issues/46)
* **mise:** parse configs with smol-toml to cover inline task env ([#48](https://github.com/espadat-studio/motus/issues/48)) ([faf3bc4](https://github.com/espadat-studio/motus/commit/faf3bc47c46336e0f51897f4e575f807db987605)), closes [#45](https://github.com/espadat-studio/motus/issues/45)


### Bug Fixes

* **env:** redact __MISE_DIFF and __MISE_SESSION blobs ([#42](https://github.com/espadat-studio/motus/issues/42)) ([5f6eca2](https://github.com/espadat-studio/motus/commit/5f6eca2781d6e275d5b9121017a4f0949086e3fd)), closes [#41](https://github.com/espadat-studio/motus/issues/41)
* **mise:** decrypt age keys in task env tables ([#47](https://github.com/espadat-studio/motus/issues/47)) ([8af4ee8](https://github.com/espadat-studio/motus/commit/8af4ee8c00e8ea6667e6a91f9eed9b4fe857deb6)), closes [#44](https://github.com/espadat-studio/motus/issues/44)

## 1.0.0 (2026-10-29)


### ⚠ BREAKING CHANGES

* **config:** config.json is no longer read; rewrite it as config.toml or every session starts degraded.

### Features

* **cc:** add claude code PreToolUse block hook ([#18](https://github.com/espadat-studio/motus/issues/18)) ([bfda787](https://github.com/espadat-studio/motus/commit/bfda78724e9b430136fa1e05861e2bfaffbe7bbc)), closes [#7](https://github.com/espadat-studio/motus/issues/7)
* **config:** switch config format from json to toml ([#20](https://github.com/espadat-studio/motus/issues/20)) ([57c0c7b](https://github.com/espadat-studio/motus/commit/57c0c7b47b7b61256a1951f782575f575d82b77f))
* **core:** add config validation, source contract, env and command sources ([#13](https://github.com/espadat-studio/motus/issues/13)) ([186ce37](https://github.com/espadat-studio/motus/commit/186ce3756d7a52a15f77ee2218a68f8193a40a49))
* **core:** add matcher with exact values, derived forms and prefixes ([#11](https://github.com/espadat-studio/motus/issues/11)) ([2db0e67](https://github.com/espadat-studio/motus/commit/2db0e6773e011fecc0d93d3407f044986b07fce6))
* **core:** blocklist for commands, paths and placeholder write-back ([#12](https://github.com/espadat-studio/motus/issues/12)) ([87b1f35](https://github.com/espadat-studio/motus/commit/87b1f35211508f0854f496cf7510ba31128b005d))
* **pi:** wire events, degraded state and /motus commands ([#16](https://github.com/espadat-studio/motus/issues/16)) ([c71cfb0](https://github.com/espadat-studio/motus/commit/c71cfb07590ebc423d2aa25c272eca3814148292))
* **sources:** add 1password source ([#22](https://github.com/espadat-studio/motus/issues/22)) ([eb17b98](https://github.com/espadat-studio/motus/commit/eb17b98da6c2ecde4b38dfcdb5d1b9ecfff642f4))
* **sources:** add mise source with drift warning ([#17](https://github.com/espadat-studio/motus/issues/17)) ([d5e810f](https://github.com/espadat-studio/motus/commit/d5e810f6c26d04f30c1b444f1c90e752d4db730e))
* **sources:** add pa source for listed entries or a whole store ([#21](https://github.com/espadat-studio/motus/issues/21)) ([d527050](https://github.com/espadat-studio/motus/commit/d5270506ba4d476a7c95a9bf4c4d483872b3fdc5))


### Bug Fixes

* **blocklist:** treat quoted heredoc bodies as literal text ([#36](https://github.com/espadat-studio/motus/issues/36)) ([b7649ba](https://github.com/espadat-studio/motus/commit/b7649ba1e52695ebb51c05604e86eb9dcb993474))
* **sources:** drop gum styling vars and credential-free urls from env ([#34](https://github.com/espadat-studio/motus/issues/34)) ([98a4468](https://github.com/espadat-studio/motus/commit/98a4468e173bcb8f0071dfef477b865e1dc3ddc8)), closes [#33](https://github.com/espadat-studio/motus/issues/33)
