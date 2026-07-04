import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PinkPagesCategories } from "./PinkPagesCategories";
import { PinkPagesListings } from "./PinkPagesListings";

export const AdminPinkPages = () => {
  const [tab, setTab] = useState("listings");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-serif text-xl font-semibold">Pink Pages</h2>
        <p className="text-sm text-muted-foreground">Manage business directory categories and listings.</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="listings">Listings</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="listings" className="mt-4">
          <PinkPagesListings />
        </TabsContent>
        <TabsContent value="categories" className="mt-4">
          <PinkPagesCategories />
        </TabsContent>
      </Tabs>
    </div>
  );
};
