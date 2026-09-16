# Fork-owned prompt helpers. Keep the shared wizard library unchanged.
DEMO_JIRA_BROKER_DEFAULT_URL="${DEMO_JIRA_BROKER_DEFAULT_URL:-https://workbench-auth.fgutica.workers.dev}"

demo_saved() {
  node --input-type=module - "$ENV_FILE" "$1" <<'JS'
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
const [file, key] = process.argv.slice(2);
process.stdout.write(existsSync(file) ? (parseEnv(readFileSync(file, 'utf8'))[key] ?? '') : '');
JS
}

demo_ask() {
  local key="$1" prompt="$2" fallback="${3:-}" secret="${4:-}" current input=""
  current=$(demo_saved "$key")
  current="${current:-${!key:-$fallback}}"
  if [[ -n "$current" ]]; then
    if [[ "$secret" == secret ]]; then
      printf '  %s [Enter keeps saved/detected secret]: ' "$prompt"
    else
      printf '  %s [%s]: ' "$prompt" "$current"
    fi
  else
    printf '  %s: ' "$prompt"
  fi
  if [[ "$secret" == secret ]]; then read -rs input || true; printf '\n'
  else read -r input || true; fi
  printf -v "$key" '%s' "${input:-$current}"
}

demo_profile_complete() {
  local key broker client_id client_secret
  for key in DEMO_GITHUB_OWNER DEMO_GITHUB_RESOURCE_MODE DEMO_JIRA_SITE_URL DEMO_JIRA_RESOURCE_MODE DEMO_JIRA_PROJECT_KEY DEMO_JIRA_BOARD_ID; do
    [[ -n "$(demo_saved "$key")" ]] || return 1
  done
  case "$(demo_saved DEMO_GITHUB_RESOURCE_MODE)" in
    reuse) [[ -n "$(demo_saved DEMO_GITHUB_REPOSITORIES)" ]] || return 1 ;;
    provision) ;;
    *) return 1 ;;
  esac
  case "$(demo_saved DEMO_JIRA_RESOURCE_MODE)" in
    reuse) [[ -n "$(demo_saved DEMO_JIRA_SPRINT_ID)" ]] || return 1 ;;
    provision) [[ -n "$(demo_saved DEMO_JIRA_EMAIL)" && -n "$(demo_saved DEMO_JIRA_API_TOKEN)" ]] || return 1 ;;
    *) return 1 ;;
  esac

  broker="$(demo_saved T3_WORKBENCH_JIRA_BROKER_URL)"
  client_id="$(demo_saved T3_WORKBENCH_JIRA_CLIENT_ID)"
  client_secret="$(demo_saved T3_WORKBENCH_JIRA_CLIENT_SECRET)"
  if [[ -n "$client_id" && -n "$client_secret" ]]; then
    [[ -n "$(demo_saved DEMO_JIRA_CALLBACK_URL)" ]] || return 1
  else
    [[ "$broker" =~ ^https://[^[:space:]]+$ ]] || return 1
  fi
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
