/** Public demo revisions are deliberately pinned; updating the scenario is an explicit fixture change. */
export const DEMO_REPOSITORIES = {
  "orbit-api": {
    repository: "filipgutica/workbench-demo-orbit-api",
    commit: "4d4e746704dc437d658b29455ce49b69ae27acf2",
  },
  "orbit-web": {
    repository: "filipgutica/workbench-demo-orbit-web",
    commit: "303abcfcf309df7c6a5594b917f2cee73c272336",
  },
} as const;
