import { Link } from "@tanstack/react-router";
import { markdownToHtml } from "@/lib/legal-markdown";
import { SiteFooter } from "./SiteFooter";

export type LegalPageId = "privacy" | "terms";

export function LegalDocument({ markdown, current }: { markdown: string; current: LegalPageId }) {
  const html = markdownToHtml(markdown);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/" className="font-display text-lg leading-none text-foreground">
            Big Game Sunday
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <LegalNavLink to="/privacy" active={current === "privacy"}>
              Privacy
            </LegalNavLink>
            <LegalNavLink to="/terms" active={current === "terms"}>
              Terms
            </LegalNavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-14">
        <article
          className="legal-prose"
          data-contact="privacy@biggamesunday.com"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

function LegalNavLink({
  to,
  active,
  children,
}: {
  to: "/privacy" | "/terms";
  active: boolean;
  children: string;
}) {
  if (active) {
    return (
      <span aria-current="page" className="font-semibold text-foreground">
        {children}
      </span>
    );
  }
  return (
    <Link
      to={to}
      className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {children}
    </Link>
  );
}
