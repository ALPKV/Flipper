import type { Metadata } from "next";
import { Container, PageHeader } from "@/components/ui";
import { Highlights } from "@/components/video/highlights";

export const metadata: Metadata = { title: "Clip Farmer" };

export default function ClipsPage() {
  return (
    <>
      <PageHeader eyebrow="Flipper video lab" title="Clip Farmer">
        Your nets session, without the waiting between shots. Choose a recording, review the clips,
        and save one highlights video. Ball analysis is optional.
      </PageHeader>
      <Container>
        <Highlights />
      </Container>
    </>
  );
}
