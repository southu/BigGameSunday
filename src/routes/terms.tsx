import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/bgs/LegalDocument";
import termsOfUse from "../../content/legal/terms-of-service.md?raw";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Big Game Sunday" },
      {
        name: "description",
        content: "Terms of Use for Big Game Sunday, a product of DP7, LLC.",
      },
      { property: "og:title", content: "Terms of Use — Big Game Sunday" },
      {
        property: "og:description",
        content: "Terms of Use for Big Game Sunday, a product of DP7, LLC.",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return <LegalDocument markdown={termsOfUse} current="terms" />;
}
