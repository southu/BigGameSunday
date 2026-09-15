import { Link } from "@tanstack/react-router";

export const SITE_COPYRIGHT =
  "© 2026 DP7, LLC. All rights reserved. Big Game Sunday is a product of DP7, LLC.";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background px-4 py-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 text-center text-sm text-muted-foreground">
        <p>{SITE_COPYRIGHT}</p>
        <nav className="flex items-center gap-4" aria-label="Legal">
          <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
