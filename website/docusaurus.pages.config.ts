import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// GitHub Pages config for docs-only build.
// This is intentionally separate from `docusaurus.config.ts` so the manager-embedded docs keep `baseUrl: "/docs/"`.

const basePathRaw = process.env.PAGES_BASE_PATH ?? "/";
const basePath = basePathRaw === "/" ? "/" : `${basePathRaw.replace(/\/$/, "")}/`;
const baseUrl = `${basePath}docs/`;

const config: Config = {
  title: "run-dat-sheesh docs",
  tagline: "Firecracker microVM sandbox runner (manager + guest agent + guest image)",
  favicon: "img/favicon.ico",

  future: { v4: true },

  url: "https://example.invalid",
  baseUrl,

  onBrokenLinks: "warn",
  markdown: {
    hooks: { onBrokenMarkdownLinks: "warn" }
  },
  i18n: { defaultLocale: "en", locales: ["en"] },

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
        theme: { customCss: "./src/css/custom.css" }
      } satisfies Preset.Options
    ]
  ],

  themeConfig: {
    colorMode: { respectPrefersColorScheme: true },
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
          href: "https://github.com/lelemm/rundatsheesh",
          label: "GitHub",
          position: "right"
        }
      ]
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Quickstart", to: "/quickstart" },
            { label: "API", to: "/api" }
          ]
        }
      ],
      copyright: `Copyright © ${new Date().getFullYear()} run-dat-sheesh`
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula
    }
  } satisfies Preset.ThemeConfig
};

export default config;

