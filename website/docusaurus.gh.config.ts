import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// GitHub-hosted build:
// - baseUrl defaults to "/" (override via GH_BASE_URL)
// - landing page served at "/"
// - docs served at "/docs/*"
// - uses a custom pages folder so we don't interfere with the embedded manager docs build

const baseUrl = process.env.GH_BASE_URL ?? "/";

const config: Config = {
  title: "run-dat-sheesh",
  tagline: "Firecracker microVM sandbox runner (manager + guest agent + guest image)",
  favicon: "img/favicon.ico",

  future: {
    v4: true
  },

  url: "https://example.invalid",
  baseUrl,

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn"
    }
  },

  i18n: {
    defaultLocale: "en",
    locales: ["en"]
  },

  // Custom landing pages directory (so embedded build remains unaffected).
  plugins: [
    [
      "@docusaurus/plugin-content-pages",
      {
        id: "landing",
        path: "src/landing-pages",
        routeBasePath: "/"
      }
    ]
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "docs",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/lelemm/rundatsheesh/tree/main/website/"
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css"
        }
      } satisfies Preset.Options
    ]
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true
    },
    navbar: {
      title: "run-dat-sheesh",
      logo: {
        alt: "run-dat-sheesh",
        src: "img/logo.svg"
      },
      items: [
        {
          to: "/docs",
          label: "Docs",
          position: "left"
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
            { label: "Quickstart", to: "/docs/quickstart" },
            { label: "API", to: "/docs/api" }
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

