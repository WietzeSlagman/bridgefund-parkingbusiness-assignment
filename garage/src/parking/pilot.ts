/** PB-03's fixed pilot contract, not a template for other buildings. */
export const PILOT = {
  code: "PB-AMS-2M8D",
  registrationLimit: 50,
  spaces: [
    { first: 1, last: 50, floor: 1, category: "RESIDENT" },
    { first: 51, last: 75, floor: 1, category: "CAR" },
    { first: 76, last: 130, floor: 2, category: "CAR" },
    { first: 131, last: 150, floor: 2, category: "MOTOR" },
  ],
} as const;
