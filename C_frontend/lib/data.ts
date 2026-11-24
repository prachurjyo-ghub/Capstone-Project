export type RequestMode = "standard" | "photo" | "urgent" | "garage" | "fleet";
export type SavedRequest = {
  id: string;
  reference: string;
  requestType: "CUSTOM_SOURCING" | "FIXED_PRICE_PURCHASE" | "USED_PART_RFQ";
  creditStatus: string;
  supplierName?: string;
  listingClassification?: "NEW_GENUINE" | "NEW_AFTERMARKET" | "USED";
  part: string;
  vehicle: string;
  year: string;
  chassis: string;
  area: string;
  phone: string;
  urgency: string;
  quantity: number;
  notes: string;
  business?: string;
  mode: RequestMode;
  ownerEmail: string;
  createdAt: string;
  status: string;
};

export const categoryCredits: Record<string, string> = {
  engine: "https://unsplash.com/photos/8DKsb8Wkgyk",
  braking: "https://unsplash.com/photos/1a_2Dsji2rA",
  suspension:
    "https://commons.wikimedia.org/wiki/File:Close-up_of_a_car_mechanic_holding_a_shock_absorber.jpg",
  electrical:
    "https://commons.wikimedia.org/wiki/File:Car_alternator_on_a_workbench_surrounded_by_various_auto_parts_in_a_garage_setting.jpg",
  filters:
    "https://www.pexels.com/photo/air-filter-in-close-up-photography-11074558/",
  lubricants:
    "https://commons.wikimedia.org/wiki/File:Pouring_engine_oil_to_motor.jpg",
};

export const businessModes = {
  garage: {
    kicker: "FOR INDEPENDENT GARAGES",
    title: "Three cars in the bays. Several parts to find.",
    text: "Send a combined list with the vehicle details you have. We organize supplier responses so your team can get back to the repairs.",
    featureLabel: "WHAT THE REQUEST SUPPORTS",
    features: [
      "Multiple parts and vehicles in one draft",
      "Saved or manually entered vehicle details",
      "A separate quantity and description for each part",
    ],
    action: "Start a garage request",
  },
  fleet: {
    kicker: "FOR FLEETS & BUSINESSES",
    title: "The vehicles keep moving. The requirements keep coming.",
    text: "Bring recurring parts needs into one place, with vehicle context and quotation records that are easier for your team to review.",
    featureLabel: "WHAT THE REQUEST SUPPORTS",
    features: [
      "Reusable saved vehicle records",
      "Multi-part requirements with individual quantities",
      "Persistent request and quotation history",
    ],
    action: "Request Fleet Supply",
  },
} as const;
