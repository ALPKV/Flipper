import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { Highlights } from "@/components/video/highlights";

export const metadata: Metadata = { title: "Clip Farmer" };

export default function ClipsPage() {
  return (
    <>
      <PageHeader eyebrow="Flipper video lab" title="Clip Farmer">
        Find sounds, review the clips and save one highlights video. Nearby sounds stay separate, with no overlapping cuts.
      </PageHeader>
      <Container>
        <Highlights />
      </Container>
    </>
  );
}
