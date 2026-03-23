export const BATCH_NY = {
  state: "New York",
  counties: ["Westchester", "Putnam", "Rockland", "Orange", "Ulster", "Sullivan", "Dutchess", "Bronx"],
  propertyTypes: ["SingleFamilyResidence", "Condominium"]
};

export const BATCH_NJ = {
  state: "New Jersey",
  counties: ["Bergen", "Essex", "Hudson", "Hunterdon", "Middlesex", "Monmouth", "Morris", "Passaic", "Somerset", "Sussex", "Union", "Warren"],
  propertyTypes: ["SingleFamilyResidence", "Condominium", "Townhouse"]
};

// Default agent info for batch runs (can be overridden via CLI or API)
export const DEFAULT_AGENT = {
  name: "",
  email: "",
  website: ""
};
