/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  mainSidebar: [
    "index",
    "dev-nexus-features",
    {
      type: "category",
      label: "User Guide",
      link: {
        type: "generated-index",
        title: "User Guide",
        description: "Set up and use DevNexus workspaces with agents.",
      },
      items: [
        "user/getting-started",
        "user/concepts",
        "user/first-workspace-existing-components",
        "user/providers-auth-hosting",
        "user/agent-targets",
        "user/agent-workflows",
        "user/skill-chains",
        "user/multi-tracker",
        "user/authority-roles",
      ],
    },
    {
      type: "category",
      label: "Development",
      link: {
        type: "generated-index",
        title: "Development",
        description: "Internal design notes for DevNexus contributors.",
      },
      items: ["dev/architecture"],
    },
  ],
};

module.exports = sidebars;
