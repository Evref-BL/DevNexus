const {themes: prismThemes} = require("prism-react-renderer");

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: "DevNexus",
  tagline: "Workspace infrastructure for agent-assisted software work.",
  url: "https://evref-bl.github.io",
  baseUrl: "/DevNexus/",
  organizationName: "Evref-BL",
  projectName: "DevNexus",
  trailingSlash: false,
  onBrokenLinks: "throw",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw",
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  presets: [
    [
      "classic",
      {
        docs: {
          path: "../docs",
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          editUrl: ({docPath}) =>
            `https://github.com/Evref-BL/DevNexus/edit/main/docs/${docPath}`,
          showLastUpdateAuthor: false,
          showLastUpdateTime: true,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: "DevNexus",
      items: [
        {
          type: "docSidebar",
          sidebarId: "mainSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://www.npmjs.com/package/@evref-bl/dev-nexus",
          label: "npm",
          position: "right",
        },
        {
          href: "https://github.com/Evref-BL/DevNexus",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            {
              label: "Getting started",
              to: "/user/getting-started",
            },
            {
              label: "Concepts",
              to: "/user/concepts",
            },
            {
              label: "Agent workflows",
              to: "/user/agent-workflows",
            },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/Evref-BL/DevNexus",
            },
            {
              label: "npm",
              href: "https://www.npmjs.com/package/@evref-bl/dev-nexus",
            },
          ],
        },
      ],
      copyright: `Copyright ${new Date().getFullYear()} Evref-BL. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

module.exports = config;
