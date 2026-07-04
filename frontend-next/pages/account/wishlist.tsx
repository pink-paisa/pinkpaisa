import type { GetServerSideProps } from "next";

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: "/account?tab=wishlist",
    permanent: false,
  },
});

export default function AccountWishlistPage() {
  return null;
}
