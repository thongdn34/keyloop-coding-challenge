# Allocation and history query shapes

These are the statements the scheduler uses for a booking and for a diary page. The supporting indexes are the partial active-resource indexes, the service-skill index, the history index on `(dealershipId, startAt, id)`, and the GiST exclusion indexes created with the bay and technician constraints.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT bay.id
FROM service_bay bay
WHERE bay."dealershipId" = $1
  AND bay.active = true
  AND NOT EXISTS (
    SELECT 1 FROM appointment booked
    WHERE booked."serviceBayId" = bay.id
      AND booked.status = 'confirmed'
      AND booked."startAt" < $3
      AND booked."endAt" > $2
  )
ORDER BY bay.id
LIMIT 1;
```

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT appointment.id
FROM appointment
WHERE appointment."dealershipId" = ANY($1)
  AND appointment."endAt" > $2
  AND appointment."startAt" < $3
ORDER BY appointment."startAt", appointment.id
LIMIT 51;
```

Regenerate both plans against a database loaded to the target volume before treating an index as sufficient. Overlap exclusion is enforced by `EXCL_appointment_bay` and `EXCL_appointment_technician`, not by these lookup indexes.
