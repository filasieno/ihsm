{
  description = "Forward to repo root flake (ihsm library sources live here)";

  inputs.repo.url = "path:../..";

  outputs = { repo, ... }: repo.outputs;
}
