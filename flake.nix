{
  description = "An idiomatic hierarchical state machine package for TypeScript";

  inputs = {
    # Rolling unstable packages; exact commit is pinned in flake.lock.
    # Bump with: nix flake update nixpkgs
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
      npmDepsHash = "sha256-ThdTsiuclLWrs5aiK37DOdXBaOuY9AMAU83vdpvMXgM=";

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

      # Git-tracked sources only; exclude local build artifacts even if present.
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
            && !(lib.hasSuffix "/website/sidebars.ts" path)
            && base != "_config.yml";
        };

      nodejs = pkgs: pkgs.nodejs_22;

      # Shared env for all npm derivations — no wall-clock or locale drift.
      npmBuildEnv = {
        SOURCE_DATE_EPOCH = toString self.lastModified;
        TZ = "UTC";
        LC_ALL = "C.UTF-8";
        LANG = "C.UTF-8";
        CI = "true";
      };

      npmPreBuild = ''
        rm -rf lib .tsc docs-build website/.docusaurus website/docs website/sidebars.ts .nyc_output coverage
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
          // (builtins.removeAttrs args [ "pkgs" ])
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

            npmScript = "build";

            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm test
              npm run test:tutorials
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

          # Docusaurus static site (interactive React tutorials — fully sandboxed).
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
            ];

            shellHook = ''
              export HUSKY=0
              export SOURCE_DATE_EPOCH="${toString self.lastModified}"
              export TZ=UTC
              export LC_ALL=C.UTF-8
              if [ -e node_modules ] && [ ! -L node_modules ]; then
                echo "ihsm: remove local node_modules/ to use Nix store deps (rm -rf node_modules)."
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

              echo "ihsm dev shell — Node $(node --version)"
              echo "nixpkgs lock: ${nixpkgsRev}"
              echo ""
              echo "Build (deterministic, sandboxed):"
              echo "  nix build              library + unit/tutorial tests"
              echo "  nix build .#lint       TypeScript, ESLint, Prettier"
              echo "  nix flake check        library + lint (CI gate)"
              echo "  bash scripts/verify-reproducible.sh .#docs"
              echo ""
              echo "Docs:"
              echo "  nix build .#docs       Docusaurus site with interactive tutorials"
              echo ""
              echo "Dev (uses the same npm lockfile as nix build):"
              echo "  npm run doc:preview    Docusaurus dev server (interactive tutorials)"
              echo "  npm run release:check  full local gate (needs network for doc)"
            '';
          };
        }
      );

      checks = forEachSystem (
        {
          pkgs,
          system,
        }:
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
