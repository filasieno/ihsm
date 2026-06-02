{
  description = "ihsm repository — forwards to packages/ihsm (library, build, Nix)";

  inputs = {
    ihsm.url = "path:./packages/ihsm";
  };

  outputs = { ihsm, ... }: ihsm.outputs;
}
