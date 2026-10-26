# Fork-owned prompt helpers. Keep the shared wizard library unchanged.

demo_saved() {
  node --input-type=module - "$ENV_FILE" "$1" <<'JS'
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const [file, key] = process.argv.slice(2);
process.stdout.write(existsSync(file) ? (parseEnv(readFileSync(file, 'utf8'))[key] ?? '') : '');
JS
}

demo_ask() {
  local key="$1" prompt="$2" fallback="${3:-}" current input=""
  current=$(demo_saved "$key")
  current="${current:-${!key:-$fallback}}"
  if [[ -n "$current" ]]; then
    printf '  %s [%s]: ' "$prompt" "$current"
  else
    printf '  %s: ' "$prompt"
  fi
  read -r input || true
  printf -v "$key" '%s' "${input:-$current}"
}

demo_profile_complete() {
  local key
  for key in DEMO_GITHUB_OWNER DEMO_GITHUB_RESOURCE_MODE; do
    [[ -n "$(demo_saved "$key")" ]] || return 1
  done
  case "$(demo_saved DEMO_GITHUB_RESOURCE_MODE)" in
    reuse) [[ -n "$(demo_saved DEMO_GITHUB_REPOSITORIES)" ]] || return 1 ;;
    provision) ;;
    *) return 1 ;;
  esac
}

# Probe only the kit's known repository pairs; do not enumerate unrelated repos.
demo_detect_repositories() {
  local owner="$1" prefix="${2:-workbench-demo}" names name found
  command -v gh >/dev/null 2>&1 || return 0
  for names in "orbit-api,orbit-web" "${prefix}-orbit-api,${prefix}-orbit-web"; do
    found=true
    for name in "${names%,*}" "${names#*,}"; do
      if ! gh api --hostname github.com "repos/$owner/$name" --silent >/dev/null 2>&1; then found=false; break; fi
    done
    if [[ "$found" == true ]]; then printf '%s' "$names"; return; fi
  done
}

# Provisioning must not retain reuse-only identities from an earlier profile.
demo_ask_reuse_resource() {
  local key="$1" prompt="$2" mode="$3" fallback="${4:-}"
  if [[ "$mode" == provision ]]; then
    printf -v "$key" '%s' ''
  else
    demo_ask "$key" "$prompt" "$fallback"
  fi
}
