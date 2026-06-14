{
  description = "An idiomatic hierarchical state machine package for TypeScript";

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
      #   nix run nixpkgs#prefetch-npm-deps -- package-lock.json
      npmDepsHash = "sha256-u2ra/DJ0yTM+Xcemb9JuuwJuzoqn0Rc/wcA+oxDOlTE=";

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

      mkSrc =
        _:
        lib.cleanSourceWith {
          src = ./.;
          filter =
            path: type:
            let
              base = baseNameOf path;
            in
            lib.cleanSourceFilter path type
            && base != "lib"
            && base != "node_modules"
            && base != "node_modules.bak"
            && !(lib.hasPrefix "result" base && (type == "directory" || type == "symlink"))
            && base != "coverage"
            && base != ".nyc_output"
            && base != ".tsc"
            && !(lib.hasInfix "/.tsc/" path)
            && base != ".eslintcache"
            && !(lib.hasInfix "/docs-build" path)
            && !(lib.hasInfix "/website/docs/" path)
            && !(lib.hasInfix "/website/.docusaurus" path)
            && !(lib.hasInfix "/website/.docs-staging" path)
            && !(lib.hasSuffix "/website/sidebars.ts" path)
            && base != "_config.yml";
        };

      nodejs = pkgs: pkgs.nodejs_22;

      npmBuildEnv = {
        SOURCE_DATE_EPOCH = toString self.lastModified;
        TZ = "UTC";
        LC_ALL = "C.UTF-8";
        LANG = "C.UTF-8";
        CI = "true";
      };

      npmPreBuild = ''
        rm -rf lib .tsc docs-build website/.docusaurus website/.docs-staging website/docs website/sidebars.ts .nyc_output coverage
      '';

      mkNpmEnv =
        {
          pkgs,
          src,
          version,
          npmDeps,
        }:
        pkgs.stdenv.mkDerivation {
          pname = "ihsm-node_modules";
          inherit version src npmDeps;
          nativeBuildInputs = with pkgs; [
            (nodejs pkgs)
            npmHooks.npmConfigHook
          ];
          dontConfigure = true;
          installPhase = ''
            runHook preInstall
            npm ci --offline --ignore-scripts --no-audit --no-fund
            mkdir -p "$out"
            cp -r website "$out/website"
            cp package.json package-lock.json LICENSE README.md "$out/"
            mv node_modules "$out/"
            runHook postInstall
          '';
        };

      mkBuildNpmPackage =
        {
          pkgs,
          pname,
          ...
        }@args:
        pkgs.buildNpmPackage (
          {
            inherit pname;
            inherit (args) version src npmDeps;
            nativeBuildInputs = [ (nodejs pkgs) ];
            npmFlags = [
              "--ignore-scripts"
            ];
            preBuild = npmPreBuild;
          }
          // npmBuildEnv
          // (removeAttrs args [ "pkgs" ])
        );

    in
    {
      packages = forEachSystem (
        {
          pkgs,
          ...
        }:
        let
          src = mkSrc null;
          version = (lib.importJSON "${./.}/package.json").version;

          npmDeps = pkgs.fetchNpmDeps {
            inherit src;
            hash = npmDepsHash;
          };

          node_modules = mkNpmEnv {
            inherit
              pkgs
              src
              version
              npmDeps
              ;
          };

          ihsm = mkBuildNpmPackage {
            inherit
              pkgs
              src
              version
              npmDeps
              ;
            pname = "ihsm";

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
              inherit node_modules npmDeps;
            };
          };

          lint = mkBuildNpmPackage {
            inherit
              pkgs
              src
              version
              npmDeps
              ;
            pname = "ihsm-lint";

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

          docs = mkBuildNpmPackage {
            inherit
              pkgs
              src
              version
              npmDeps
              ;
            pname = "ihsm-docs";

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

        in
        {
          inherit
            ihsm
            lint
            docs
            node_modules
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
          node_modules = self.packages.${system}.node_modules;
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
              # Repo root forwards this flake; npm scripts live in packages/ihsm.
              if [ -f packages/ihsm/package.json ] && [ ! -f package.json ]; then
                cd packages/ihsm
              fi
              if [ -e node_modules ] && [ ! -L node_modules ]; then
                echo "ihsm: remove local node_modules/ to use Nix store deps (rm -rf node_modules)." >&2
              else
                ln -snf ${node_modules}/node_modules node_modules
              fi
              export PATH="${nodejs pkgs}/bin:$PATH"

              _ihsm_dev_ps1=$'\033[1;36m(ihsm)\033[0m '
              if [ -n "''${ZSH_VERSION:-}" ]; then
                case "''${PROMPT}" in
                  *"(ihsm)"*) ;;
                  *) PROMPT="''${_ihsm_dev_ps1}''${PROMPT}"; export PROMPT ;;
                esac
              elif [ -n "''${PS1:-}" ]; then
                case "''${PS1}" in
                  *"(ihsm)"*) ;;
                  *) PS1="''${_ihsm_dev_ps1}''${PS1}"; export PS1 ;;
                esac
              fi

              echo "ihsm dev shell — Node $(node --version)" >&2
              echo "nixpkgs lock: ${nixpkgsRev}" >&2
              echo "" >&2
              echo "Build (deterministic, sandboxed):" >&2
              echo "  nix build              library + unit/example tests" >&2
              echo "  nix build .#lint       TypeScript, ESLint, Prettier" >&2
              echo "  nix flake check        library + lint (CI gate)" >&2
              echo "  bash scripts/verify-reproducible.sh .#docs" >&2
              echo "" >&2
              echo "Docs:" >&2
              echo "  nix build .#docs       Docusaurus site (reference + testing)" >&2
              echo "" >&2
              echo "Dev (uses the same npm lockfile as nix build):" >&2
              echo "  npm run test:all         Node + minified browser (unit + examples)" >&2
              echo "  Chromium for Playwright:  $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" >&2
              echo "  npm run doc:preview    Docusaurus dev server (reference + playgrounds)" >&2
              echo "  npm run release:check  full local gate (needs network for doc)" >&2
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
          inherit (packages) default lint docs;
          ihsm = packages.default;
        }
      );

      formatter = forEachSystem ({ pkgs, ... }: pkgs.nixfmt);
    };
}
