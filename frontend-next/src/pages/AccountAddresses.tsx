import Link from "next/link";
import { ArrowLeft, MapPinPlus } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AddressBookManager from "@/components/account/AddressBookManager";
import { Button } from "@/components/ui/button";

const AccountAddresses = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <div className="container mx-auto py-10 md:py-16">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/account?tab=profile" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to account
          </Link>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Pink Paisa account</p>
          <h1 className="mt-2 font-serif text-4xl">Address book</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            Save multiple delivery addresses once, choose the right one at checkout, and stop overwriting your default details for one-off orders.
          </p>
        </div>
        <Button variant="outline" className="rounded-2xl" asChild>
          <Link href="/checkout">
            <MapPinPlus className="mr-2 h-4 w-4" /> Use at checkout
          </Link>
        </Button>
      </div>

      <div className="rounded-[32px] border border-border bg-card p-6 shadow-sm md:p-8">
        <AddressBookManager />
      </div>
    </div>
    <Footer />
  </div>
);

export default AccountAddresses;
