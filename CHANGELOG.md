# Changelog

## [1.3.1](https://github.com/espadat-studio/motus/compare/v1.3.0...v1.3.1) (2026-11-02)


### Bug Fixes

* **blocklist:** block configured spelling of symlinked paths ([#73](https://github.com/espadat-studio/motus/issues/73)) ([9a7fc5f](https://github.com/espadat-studio/motus/commit/9a7fc5f58c4763e2f5437c04cbcf146396af47d5))
* **blocklist:** block file uri arguments to blocked paths ([#75](https://github.com/espadat-studio/motus/issues/75)) ([bb9ef55](https://github.com/espadat-studio/motus/commit/bb9ef55a8290b4f0f2c10c3797d392c4bbf28186))
* **blocklist:** block grep roots containing blocked paths ([#79](https://github.com/espadat-studio/motus/issues/79)) ([4563ef0](https://github.com/espadat-studio/motus/commit/4563ef0e1208b491960bb1a5683045a0120727cc))
* **blocklist:** match slash-bearing blockCommands entries ([#85](https://github.com/espadat-studio/motus/issues/85)) ([034ed12](https://github.com/espadat-studio/motus/commit/034ed12bf80ee5fd6bc0fd78f4c5a896d7d1f266))
* **blocklist:** reject every emitted placeholder on write-back ([#81](https://github.com/espadat-studio/motus/issues/81)) ([df038f0](https://github.com/espadat-studio/motus/commit/df038f0c59c843161f1ef1178db1bf9c8c676292))
* **blocklist:** treat empty variables as unset in blockPaths ([#76](https://github.com/espadat-studio/motus/issues/76)) ([900baae](https://github.com/espadat-studio/motus/commit/900baae403f5b81d9f43e73afbe63946cca28652))
* **config:** validate prefixes at config parse ([#77](https://github.com/espadat-studio/motus/issues/77)) ([8aeb182](https://github.com/espadat-studio/motus/commit/8aeb182ae510c4fc34beb07d59db934fe37dbc25))
* **matcher:** redact common percent-encoder spellings ([#86](https://github.com/espadat-studio/motus/issues/86)) ([5c9db41](https://github.com/espadat-studio/motus/commit/5c9db41bc3daa3fc00e7d7adfcb24d627936a743))
* **matcher:** skip inapplicable percent variants and document limits ([f1e0290](https://github.com/espadat-studio/motus/commit/f1e02907007019a6073b8ffdb5222e0bdd30a881))
* **pa:** keep decrypted entries when one entry fails ([#88](https://github.com/espadat-studio/motus/issues/88)) ([78b1e90](https://github.com/espadat-studio/motus/commit/78b1e9070f572ecd16ff9cae5e59221968bdebaa))
* **pi:** block paths spelled with @, unicode spaces or file urls ([3bfa8f9](https://github.com/espadat-studio/motus/commit/3bfa8f9ab7f0b381ff462cd20ee0cb7692afe2ec))
* **pi:** clear raw fields when redaction fails ([#84](https://github.com/espadat-studio/motus/issues/84)) ([b63defe](https://github.com/espadat-studio/motus/commit/b63defe25b418bc4381d2e3f42e7cb416d0f413a))
* **pi:** hold prompts until secrets load ([#78](https://github.com/espadat-studio/motus/issues/78)) ([7888ac9](https://github.com/espadat-studio/motus/commit/7888ac9c51494e877a0a99045f2af9ff84008cba))
* **pi:** normalize path arguments like pi ([#74](https://github.com/espadat-studio/motus/issues/74)) ([3bfa8f9](https://github.com/espadat-studio/motus/commit/3bfa8f9ab7f0b381ff462cd20ee0cb7692afe2ec))
* **pi:** report load warnings on stderr without a ui ([#80](https://github.com/espadat-studio/motus/issues/80)) ([8f632db](https://github.com/espadat-studio/motus/commit/8f632db33fc972e34d045e41de3eae69e5567629))
* **sources:** treat semicolon and hash database urls as secret ([#71](https://github.com/espadat-studio/motus/issues/71)) ([9174123](https://github.com/espadat-studio/motus/commit/917412390955bd5d88bc7bb3610b8f5d77320e29))

## [1.3.0](https://github.com/espadat-studio/motus/compare/v1.2.0...v1.3.0) (2026-11-02)


### Features

* **mise:** discover conf.d, .config/mise/mise.toml and vars keys ([#59](https://github.com/espadat-studio/motus/issues/59)) ([0710419](https://github.com/espadat-studio/motus/commit/071041988616c8074d16ccbf78818d729c1e949a))


### Bug Fixes

* **blocklist:** drop backslash-newline in the tokenizer ([#61](https://github.com/espadat-studio/motus/issues/61)) ([75b3492](https://github.com/espadat-studio/motus/commit/75b3492f7ff3a6438952fe1e3ba1573786a2db80))
* **blocklist:** skip shell comments in the tokenizer ([#60](https://github.com/espadat-studio/motus/issues/60)) ([47bdc74](https://github.com/espadat-studio/motus/commit/47bdc746c516ea51d7339af7955681179daa8c35))
* **blocklist:** tokenize redirections apart from command words ([#62](https://github.com/espadat-studio/motus/issues/62)) ([a4a8845](https://github.com/espadat-studio/motus/commit/a4a88458957dd6c91e1fde94e6ffc3fa9f6ad725))
* **matcher:** derive each value of a url hash ([#67](https://github.com/espadat-studio/motus/issues/67)) ([3c05eca](https://github.com/espadat-studio/motus/commit/3c05eca3541671a18ded59798f119ea8b0d22772))
* **matcher:** derive JSON and shell-quoted secret spellings ([#65](https://github.com/espadat-studio/motus/issues/65)) ([b16de85](https://github.com/espadat-studio/motus/commit/b16de85ae3338d5e358de2abcd7b91ff30008e17))
* **matcher:** match vendor prefixes after escape residue ([#68](https://github.com/espadat-studio/motus/issues/68)) ([44978ec](https://github.com/espadat-studio/motus/commit/44978ec0961351eb7a06cbfca5cd28c21412231f))
* **mise:** decrypt task keys only from listed roots ([#57](https://github.com/espadat-studio/motus/issues/57)) ([291cd72](https://github.com/espadat-studio/motus/commit/291cd72173d9d70c65b5098a8bccfb4925f0b59e))
* **pi:** redact compaction and branch summary requests ([#66](https://github.com/espadat-studio/motus/issues/66)) ([2b8b90b](https://github.com/espadat-studio/motus/commit/2b8b90b2b35d76525878c8fe7fb61e00d9ddcc73))
* **pi:** refuse ! commands holding a loaded value ([#64](https://github.com/espadat-studio/motus/issues/64)) ([381423a](https://github.com/espadat-studio/motus/commit/381423afe3c1270eb60cdd0f00d339ecd7ae33ea))
* **pi:** refuse /motus continue when blocks did not load ([#63](https://github.com/espadat-studio/motus/issues/63)) ([9d066e1](https://github.com/espadat-studio/motus/commit/9d066e11c60003cffa2942900d0caea297950dbb))
* **sources:** keep partial secrets when a source times out ([#69](https://github.com/espadat-studio/motus/issues/69)) ([7b8ca46](https://github.com/espadat-studio/motus/commit/7b8ca463878d52f5f21ebf584cd61d9c268d189f))

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
