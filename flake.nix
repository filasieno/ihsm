{
  description = "ihsm monorepo — ihsm, @ihsm/core, @ihsm/otel (deterministic Nix builds)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
    }:
    let
      inherit (nixpkgs) lib;

      # Regenerate when package-lock.json changes:
      #   ihsm: nix run nixpkgs#prefetch-npm-deps -- packages/ihsm/package-lock.json
      #   otel: build once with lib.fakeHash, or prefetch from otel-src-npm-deps output
      #         (file:ihsm-dev.tgz is stripped — see nix/common.nix otelSrcForNpmDeps)
      npmDepsHash = {
        ihsm = "sha256-u2ra/DJ0yTM+Xcemb9JuuwJuzoqn0Rc/wcA+oxDOlTE=";
        otel = "sha256-ughi096KHViVyrUyfIlygvyaRAylgFHytDm6B8P2KCM=";
      };

      nixpkgsRev = (builtins.fromJSON (builtins.readFile ./flake.lock)).nodes.nixpkgs.locked.rev;

      supportedSystems = lib.filter (system: system != "x86_64-darwin") (import systems);

      forEachSystem =
        f:
        lib.genAttrs supportedSystems (
          system:
          f {
            inherit system;
            pkgs = import nixpkgs {
              inherit system;
              config.allowUnfree = false;
            };
          }
        );

      common = import ./nix/common.nix {
        inherit lib;
        pkgs = import nixpkgs {
          system = builtins.head supportedSystems;
          config.allowUnfree = false;
        };
      };

    in
    {
      packages = forEachSystem (
        {
          pkgs,
          ...
        }:
        let
          common' = import ./nix/common.nix {
            inherit lib pkgs;
          };

          inherit (common')
            nodejs
            npmPreBuild
            mkIhsmSrc
            mkCoreSrc
            mkOtelSrc
            mkBuildNpmPackage
            mkTypeScriptReexportPackage
            packIhsmTarball
            linkBuiltIhsmNodeModules
            copyIhsmDevTarball
            otelSrcWithIhsmTarball
            otelSrcForNpmDeps
            ;

          ihsmSrc = mkIhsmSrc;
          ihsmVersion = (lib.importJSON "${ihsmSrc}/package.json").version;

          ihsmNpmDeps = pkgs.fetchNpmDeps {
            src = ihsmSrc;
            hash = npmDepsHash.ihsm;
          };

          ihsm = mkBuildNpmPackage self {
            pname = "ihsm";
            version = ihsmVersion;
            src = ihsmSrc;
            npmDeps = ihsmNpmDeps;

            nativeBuildInputs = [
              (nodejs pkgs)
              pkgs.chromium
            ];

            npmScript = "build";

            doCheck = true;
            checkPhase = ''
              runHook preCheck
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
              npm run test:all
              runHook postCheck
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib"
              cp -r lib/. "$out/lib/"
              cp package.json LICENSE README.md "$out/"
              runHook postInstall
            '';
            passthru = {
              inherit ihsmNpmDeps;
            };
          };

          lint = mkBuildNpmPackage self {
            pname = "ihsm-lint";
            version = ihsmVersion;
            src = ihsmSrc;
            npmDeps = ihsmNpmDeps;

            nativeBuildInputs = [
              (nodejs pkgs)
              pkgs.plantuml
              pkgs.graphviz
            ];

            npmScript = "build";
            dontNpmBuild = true;

            doCheck = true;
            checkPhase = ''
              runHook preCheck
              bash scripts/verify-no-generated-in-source.sh
              npm run lint
              runHook postCheck
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              touch "$out/.ok"
              runHook postInstall
            '';
          };

          docs = mkBuildNpmPackage self {
            pname = "ihsm-docs";
            version = ihsmVersion;
            src = ihsmSrc;
            npmDeps = ihsmNpmDeps;

            nativeBuildInputs = [
              (nodejs pkgs)
              pkgs.plantuml
              pkgs.graphviz
            ];

            buildPhase = ''
              runHook preBuild
              bash scripts/verify-no-generated-in-source.sh
              export IHSM_REQUIRE_PLANTUML=1
              npm run build
              npm run build -w ihsm-site
              test -f docs-build/index.html
              bash scripts/verify-docs-site.sh docs-build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/share/doc/ihsm"
              cp -r docs-build/* "$out/share/doc/ihsm/"
              runHook postInstall
            '';
          };

          ihsmDevTarball = packIhsmTarball ihsm;

          coreSrc = mkCoreSrc;
          coreVersion = (lib.importJSON "${coreSrc}/package.json").version;

          core = mkTypeScriptReexportPackage {
            pname = "@ihsm/core";
            version = coreVersion;
            src = coreSrc;
            inherit ihsm;
          };

          otelSrc = mkOtelSrc;
          otelVersion = (lib.importJSON "${otelSrc}/package.json").version;
          otelNpmSrc = otelSrcForNpmDeps otelSrc;

          otel = mkBuildNpmPackage self {
            pname = "@ihsm/otel";
            version = otelVersion;
            src = otelNpmSrc;
            npmDeps = pkgs.fetchNpmDeps {
              src = otelNpmSrc;
              hash = npmDepsHash.otel;
            };

            npmFlags = [
              "--ignore-scripts"
              "--legacy-peer-deps"
            ];

            preBuild = npmPreBuild + ''
              ${linkBuiltIhsmNodeModules ihsm}
            '';

            npmScript = "build";

            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm test
              npm audit --omit=dev
              runHook postCheck
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/lib"
              cp -r lib/. "$out/lib/"
              cp package.json "$out/"
              runHook postInstall
            '';
          };

          release = pkgs.runCommand "ihsm-release-${ihsmVersion}" { } ''
            mkdir -p $out/ihsm $out/core $out/otel
            cp -r ${ihsm}/. $out/ihsm/
            cp -r ${core}/. $out/core/
            cp -r ${otel}/. $out/otel/
            echo "${ihsmVersion}" > $out/VERSION
          '';

        in
        {
          inherit
            ihsm
            core
            otel
            lint
            docs
            release
            ihsmDevTarball
            ;
          default = ihsm;
        }
      );

      devShells = forEachSystem (
        {
          pkgs,
          system,
        }:
        let
          common' = import ./nix/common.nix {
            inherit lib pkgs;
          };
          inherit (common') nodejs;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              (nodejs pkgs)
              bash
              git
              plantuml
              graphviz
              chromium
            ];

            shellHook = ''
              export HUSKY=0
              export IHSM_REQUIRE_PLANTUML=1
              export SOURCE_DATE_EPOCH="${toString self.lastModified}"
              export TZ=UTC
              export LC_ALL=C.UTF-8
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
              export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
              export PATH="${nodejs pkgs}/bin:$PATH"

              echo "ihsm monorepo dev shell — Node $(node --version)" >&2
              echo "nixpkgs lock: ${nixpkgsRev}" >&2
              echo "" >&2
              echo "Nix builds (deterministic, sandboxed):" >&2
              echo "  nix build .#ihsm          library + tests" >&2
              echo "  nix build .#core          @ihsm/core" >&2
              echo "  nix build .#otel          @ihsm/otel + tests" >&2
              echo "  nix build .#release       all publish artifacts" >&2
              echo "  nix flake check           CI gate (ihsm + core + otel + lint + docs)" >&2
              echo "" >&2
              echo "Package dirs: packages/ihsm, packages/core, packages/otel" >&2
            '';
          };
        }
      );

      checks = forEachSystem (
        { system, ... }:
        let
          packages = self.packages.${system};
        in
        {
          inherit (packages)
            ihsm
            core
            otel
            lint
            docs
            ;
          default = packages.ihsm;
        }
      );

      formatter = forEachSystem ({ pkgs, ... }: pkgs.nixfmt);
    };
}
