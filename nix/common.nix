# Shared helpers for ihsm monorepo npm packages (buildNpmPackage).
{ lib, pkgs }:

let
  nodejs = pkgs: pkgs.nodejs_22;

  npmBuildEnv = self: {
    SOURCE_DATE_EPOCH = toString self.lastModified;
    TZ = "UTC";
    LC_ALL = "C.UTF-8";
    LANG = "C.UTF-8";
    CI = "true";
  };

  npmPreBuild = ''
    rm -rf lib .tsc docs-build website/.docusaurus website/.docs-staging website/docs website/sidebars.ts .nyc_output coverage
  '';

  mkPackageSrc =
    packagePath: extraFilter:
    lib.cleanSourceWith {
      src = packagePath;
      filter =
        p: type:
        let
          base = baseNameOf p;
        in
        lib.cleanSourceFilter p type
        && base != "node_modules"
        && base != "lib"
        && base != ".tsc"
        && !(lib.hasInfix "/node_modules/" p)
        && !(lib.hasInfix "/lib/" p)
        && !(lib.hasInfix "/.tsc/" p)
        && base != "coverage"
        && base != ".nyc_output"
        && base != ".eslintcache"
        && !(lib.hasInfix "/docs-build" p)
        && !(lib.hasInfix "/website/.docusaurus" p)
        && !(lib.hasInfix "/website/node_modules" p)
        && (extraFilter p type base);
    };

  mkIhsmSrc = mkPackageSrc ../packages/ihsm (
    _p: _type: base:
    base != "_config.yml"
      && !(lib.hasInfix "/website/docs/" _p)
      && !(lib.hasInfix "/website/.docs-staging" _p)
      && !(lib.hasSuffix "/website/sidebars.ts" _p)
  );

  mkCoreSrc = mkPackageSrc ../packages/core (_p: _type: _base: true);

  mkOtelSrc = mkPackageSrc ../packages/otel (
    _p: _type: base: base != "ihsm-dev.tgz" && base != "ihsm-0.1.21.tgz"
  );

  mkBuildNpmPackage =
    self: args:
    pkgs.buildNpmPackage (
      {
        nativeBuildInputs = [ (nodejs pkgs) ];
        npmFlags = [ "--ignore-scripts" ];
        preBuild = npmPreBuild;
      }
      // npmBuildEnv self
      // args
    );

  packIhsmTarball = ihsm:
    pkgs.runCommand "ihsm-dev-tarball" {
      nativeBuildInputs = [ (nodejs pkgs) ];
    } ''
      export HOME="$TMPDIR"
      mkdir -p "$TMPDIR/pack" "$out"
      cp -r ${ihsm}/lib "$TMPDIR/pack/"
      cp ${ihsm}/package.json ${ihsm}/README.md ${ihsm}/LICENSE "$TMPDIR/pack/"
      (cd "$TMPDIR/pack" && npm pack --pack-destination "$out")
      mv "$out"/*.tgz "$out/ihsm-dev.tgz"
    '';

  linkBuiltIhsmNodeModules = ihsm: ''
    mkdir -p node_modules/ihsm
    cp -r ${ihsm}/lib node_modules/ihsm/
    cp ${ihsm}/package.json node_modules/ihsm/
  '';

  copyIhsmDevTarball = tarball: ''
    cp ${tarball}/ihsm-dev.tgz "$sourceRoot/ihsm-dev.tgz"
  '';

  otelSrcWithIhsmTarball = otelSrc: tarball:
    pkgs.runCommand "otel-src-with-ihsm-tgz" { } ''
      cp -r ${otelSrc}/. $out/
      chmod -R u+w $out
      cp ${tarball}/ihsm-dev.tgz $out/ihsm-dev.tgz
    '';

  # fetchNpmDeps cannot resolve file:ihsm-dev.tgz — strip it for the fixed-output deps hash.
  otelSrcForNpmDeps = otelSrc:
    pkgs.runCommand "otel-src-npm-deps" {
      nativeBuildInputs = [ pkgs.jq ];
    } ''
      cp -r ${otelSrc}/. $out/
      chmod -R u+w $out
      jq 'del(.devDependencies.ihsm)' $out/package.json > $out/package.json.new
      mv $out/package.json.new $out/package.json
      jq '
        .packages[""].devDependencies |= del(.ihsm)
        | del(.packages["node_modules/ihsm"])
      ' $out/package-lock.json > $out/package-lock.json.new
      mv $out/package-lock.json.new $out/package-lock.json
    '';

  mkTypeScriptReexportPackage =
    {
      ihsm,
      pname,
      version,
      src,
    }:
    pkgs.stdenv.mkDerivation {
      inherit pname version src;
      nativeBuildInputs = [ (nodejs pkgs) pkgs.typescript ];
      preBuild = npmPreBuild;
      buildPhase = ''
        runHook preBuild
        mkdir -p node_modules/ihsm
        cp -r ${ihsm}/lib node_modules/ihsm/
        cp ${ihsm}/package.json node_modules/ihsm/
        tsc -b tsconfig.lib.json tsconfig.esm.json
        node scripts/finalize-build.mjs
      '';
      installPhase = ''
        runHook preInstall
        mkdir -p "$out/lib"
        cp -r lib/. "$out/lib/"
        cp package.json "$out/"
        runHook postInstall
      '';
    };

in
{
  inherit
    lib
    pkgs
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
}
