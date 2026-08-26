import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: "/start-here",
    permanent: true,
  },
});

export default function InstagramRedirectPage() {
  return null;
}
