# Gate controllers: integration notes for ParkingBusiness

From the gate vendor.

## Gates

The pilot building has four gates: `entrance-1`, `entrance-2`, `exit-1` and `exit-2`. Each gate
controller calls your API over HTTPS.

## Requests and retries

- Every request carries an `X-Request-Id` header: one UUID per vehicle event at the barrier.
- A gate waits 2 seconds for an answer. Without one, it sends the same request again, with the same
  `X-Request-Id`, up to three times. The barrier acts on the first 2xx it receives.
- Under load, a retry can arrive while the first request is still being processed.

## Licence plates

Plates come from the camera as read: upper or lower case, with or without dashes or spaces. For example
`AB-123-C`, `ab123c` and `AB 123 C` are the same car.

## At the exit

The exit gate shows the amount due from your check-out response. It opens when the driver has paid, or
straight away when nothing is due.
