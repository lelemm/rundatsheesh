import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: "run-dat-sheesh docs",
  tagline: "Firecracker microVM sandbox runner (manager + guest agent + guest image)",
  favicon: "img/favicon.ico",

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  // The absolute value isn't important for our embedded use-case; links are generated from baseUrl.
  url: "https://example.invalid",
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: "/docs/",

  // This site is embedded under `/docs`, but it intentionally links to manager endpoints
  // that live outside the docs baseUrl (e.g. `/swagger`, `/openapi.json`).
  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn"
    }
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: "en",
    locales: ["en"]
  },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/lelemm/rundatsheesh/tree/main/website/"
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css"
        }
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true
    },
    navbar: {
      title: "run-dat-sheesh",
      logo: {
        alt: "run-dat-sheesh",
        src: "img/logo.png"
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs"
        },
        {
          href: "../swagger",
          label: "Swagger",
          position: "right"
        },
        {
          href: "https://github.com/lelemm/rundatsheesh",
          label: "GitHub",
          position: "right"
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
              label: "Quickstart",
              to: "/quickstart"
            }
          ],
        },
        {
          title: "API",
          items: [
            { label: "Swagger UI", href: "../swagger" },
            { label: "OpenAPI JSON", href: "../openapi.json" }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} run-dat-sheesh`
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
