-- The date the signatory themselves wrote, kept beside the date we observed.
--
-- Under the Indian Contract Act, 1872 a contract is formed by acceptance, and
-- the *date of acceptance* is a term of the bargain rather than a system log
-- line. A conventional signature block has always carried one because the
-- parties assert it; a server timestamp is something the system asserts about
-- them. They are different evidential facts and a record that keeps only the
-- second cannot show the first.
--
-- Both are stored, deliberately, and neither overwrites the other:
--
--   signed_date        what the signatory typed, as a calendar date
--   occurred_at        when the server committed the decision (already present)
--
-- Where they diverge that divergence is itself evidence and must survive. A
-- customer in Dubai signing an Indian contract late at night legitimately
-- writes tomorrow's date; silently normalising it to the server's day would
-- destroy the fact. The application bounds how far apart they may be and
-- refuses an absurd gap, but it never rewrites what the person wrote.

ALTER TABLE decisions ADD COLUMN signed_date date;

-- The signatory's own declared place of signing, where they give one. Indian
-- stamp duty is a state subject and the place of execution is what determines
-- which state's rate applies, so this is the field a finance team needs and
-- cannot reconstruct afterwards. Nullable: it is asked for, never demanded.
ALTER TABLE decisions ADD COLUMN signed_place text;

COMMENT ON COLUMN decisions.signed_date IS
  'Calendar date asserted by the signatory. Never derived from occurred_at.';
COMMENT ON COLUMN decisions.signed_place IS
  'Place of signing as declared by the signatory; relevant to stamp duty jurisdiction.';
