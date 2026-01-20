import React from "react";
import clsx from "clsx";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import CodeBlock from "@theme/CodeBlock";
import useBaseUrl from "@docusaurus/useBaseUrl";
import styles from "./index.module.css";

export default function Landing(): JSX.Element {
  const logoUrl = useBaseUrl("/img/logo.svg");

  return (
    <Layout
      title="run-dat-sheesh"
      description="Run untrusted code on your infrastructure via Firecracker microVMs (manager + guest agent + guest image)."
    >
      <header className={clsx("hero", "hero--primary", styles.heroBanner)}>
        <div className="container">
          <img src={logoUrl} alt="run dat sheesh" className={styles.heroLogo} />
          <h1 className="hero__title">Run Untrusted Code on Your Infrastructure</h1>
          <p className={clsx("hero__subtitle", styles.heroText)}>
            A self-hosted REST API to spin up Firecracker microVMs, execute LLM-generated code in isolation, and manage
            snapshots.
          </p>
          <div className="buttons">
            <Link className="button button--secondary button--lg" to="/docs/quickstart">
              Quickstart
            </Link>
            <Link
              className="button button--outline button--lg"
              href="https://github.com/lelemm/rundatsheesh"
              style={{ marginLeft: "0.75rem" }}
            >
              View on GitHub
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className={styles.section} id="features">
          <div className="container">
            <h2>Why run-dat-sheesh?</h2>
            <p>
              Keep the dangerous stuff contained: run user/LLM code inside a microVM, keep your manager API in control,
              and ship files via safe tar.gz streams.
            </p>
            <div className={styles.cards}>
              <div className={styles.card}>
                <h3>Firecracker isolation</h3>
                <p>Each workload runs in its own microVM, with an agent reachable over vsock.</p>
              </div>
              <div className={styles.card}>
                <h3>Simple REST API</h3>
                <p>Create VMs, execute TypeScript via Deno, manage snapshots, and move files in/out.</p>
              </div>
              <div className={styles.card}>
                <h3>Self-hosted</h3>
                <p>Run the manager in a privileged Docker container and keep full control of infra and data.</p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section} id="install">
          <div className="container">
            <h2>Install</h2>
            <p>Start with the docs Quickstart, or build from source.</p>
            <div className={styles.codeBlock}>
              <CodeBlock language="bash">{`# Read the quickstart
open /docs/quickstart

# Or build the docs site locally
cd website
npm ci
npm run build:gh
`}</CodeBlock>
            </div>
          </div>
        </section>

        <section className={styles.section} id="api">
          <div className="container">
            <h2>API</h2>
            <p>
              The manager exposes a REST API for VM lifecycle and execution. See the docs and API reference for details.
            </p>
            <div className="buttons">
              <Link className="button button--primary button--lg" to="/docs/api">
                API docs
              </Link>
              <Link className="button button--outline button--lg" to="/docs/env-vars" style={{ marginLeft: "0.75rem" }}>
                Env vars
              </Link>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

