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
      npmDepsHash = "sha256-buUWh4BREYhvzpkBrfr0DwjJLKyYRv/9iS2uZS7eiuQ=";

      nixpkgsRev =
        (builtins.fromJSON (builtins.readFile ./flake.lock)).nodes.nixpkgs.locked.rev;

      forEachSystem =
        f:
        lib.genAttrs (import systems) (
          system:
          f {
            pkgs = import nixpkgs {
              inherit system;
              config.allowUnfree = false;
            };
          }
        );

      mkSrc = _: lib.cleanSource ./.;

      nodejs = pkgs: pkgs.nodejs_22;

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
            mv node_modules "$out/"
            runHook postInstall
          '';
        };

    in
    {
      packages = forEachSystem (
        {
          pkgs,
        }:
        let
          src = mkSrc pkgs;
          version = (lib.importJSON "${./.}/package.json").version;

          npmDeps = pkgs.fetchNpmDeps {
            inherit src;
            hash = npmDepsHash;
          };

          node_modules = mkNpmEnv {
            inherit pkgs src version npmDeps;
          };

          ihsm = pkgs.buildNpmPackage {
            pname = "ihsm";
            inherit version src npmDeps;

            nativeBuildInputs = [ (nodejs pkgs) ];

            npmFlags = [
              "--ignore-scripts"
            ];

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

          lint = pkgs.buildNpmPackage {
            pname = "ihsm-lint";
            inherit version src npmDeps;

            nativeBuildInputs = [ (nodejs pkgs) ];

            npmFlags = [
              "--ignore-scripts"
            ];

            npmScript = "build";

            doCheck = true;
            checkPhase = ''
              runHook preCheck
              npm run lint
              npm run typecheck:tutorials
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
          docs = pkgs.buildNpmPackage {
            pname = "ihsm-docs";
            inherit version src npmDeps;

            nativeBuildInputs = [ (nodejs pkgs) ];

            npmFlags = [
              "--ignore-scripts"
            ];

            buildPhase = ''
              runHook preBuild
              npm run build
              npm run doc
              bash scripts/verify-docs-site.sh site/build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p "$out/share/doc/ihsm"
              cp -r site/build/* "$out/share/doc/ihsm/"
              runHook postInstall
            '';
          };

        in
        {
          inherit ihsm lint docs node_modules;
          default = ihsm;
        }
      );

      devShells = forEachSystem (
        {
          pkgs,
        }:
        let
          node_modules = self.packages.${pkgs.system}.node_modules;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              (nodejs pkgs)
              bash
              git
            ];

            shellHook = ''
              export HUSKY=0
              if [ -e node_modules ] && [ ! -L node_modules ]; then
                echo "ihsm: local node_modules directory shadows the Nix store — rename or remove it to use the dev shell deps."
              else
                ln -snf ${node_modules}/node_modules node_modules
              fi
              export PATH="${nodejs pkgs}/bin:$PATH"

              echo "ihsm dev shell — Node $(node --version)"
              echo "nixpkgs lock: ${nixpkgsRev}"
              echo ""
              echo "Build (deterministic, sandboxed):"
              echo "  nix build              library + unit/tutorial tests"
              echo "  nix build .#lint       eslint, prettier, tutorial typecheck"
              echo "  nix flake check        library + lint (CI gate)"
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
        }:
        let
          packages = self.packages.${pkgs.system};
        in
        {
          inherit (packages) default lint;
          ihsm = packages.default;
        }
      );

      formatter = forEachSystem ({ pkgs, }: pkgs.nixfmt-rfc-style);
    };
}
