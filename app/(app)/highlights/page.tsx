import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { Highlights } from "@/components/video/highlights";

export const metadata: Metadata = { title: "Clip Farmer" };

export default function ClipsPage() {
  return (
    <>
      <PageHeader eyebrow="Session editor" title="Clip Farmer">
        Make the cut. Keep every moment you choose.
      </PageHeader>
      <Container>
        <Highlights />
      </Container>
    </>
  );
}
