import BookingFlow from "./BookingFlow";

type Props = { params: Promise<{ tenantSlug: string; propertySlug: string }> };

export default async function TenantPropertyBookingPage({ params }: Props) {
  const { tenantSlug, propertySlug } = await params;
  return <BookingFlow tenantSlug={tenantSlug} propertySlug={propertySlug} />;
}
