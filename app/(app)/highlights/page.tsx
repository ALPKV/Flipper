import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { Highlights } from "@/components/video/highlights";

export const metadata: Metadata = { title: {absolute:"Flipper"} };

export default function ClipsPage() {
  return (
    <>
      <PageHeader eyebrow="Session editor" title="Flipper">
        Make the cut. Keep every moment you choose.
      </PageHeader>
      <Container>
        <Highlights />
      </Container>
    </>
  );
}
