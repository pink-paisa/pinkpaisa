import type { UserAddress } from "@/hooks/useAccountAddresses";
import AddressBookManager from "@/components/account/AddressBookManager";

type AddressPickerProps = {
  selectedAddressId?: string | null;
  onSelectAddress: (address: UserAddress | null) => void;
};

const AddressPicker = ({ selectedAddressId = null, onSelectAddress }: AddressPickerProps) => (
  <AddressBookManager
    selectable
    compact
    selectedAddressId={selectedAddressId}
    onSelectAddress={onSelectAddress}
    title="Saved addresses"
    description="Pick a saved address to prefill checkout. You can still tweak the shipping fields below before placing the order."
  />
);

export default AddressPicker;
