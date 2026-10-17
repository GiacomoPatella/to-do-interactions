/**
 * The stationery around the desk skin's page: everything that makes the
 * page a notepad rather than a loose sheet. None of it is interactive and
 * none of it moves — it is the object the list is written in.
 *
 * A top-bound, spiral notepad, at every width: the coil, a few leaves
 * under today's page showing at the sides (drawn by .wrap::before), the
 * kraft back board under those, and the pages already used curled over
 * the coil behind it. A two-page agenda was tried first and dropped:
 * yesterday's page beside today's pulled the eye off the list. A glued
 * head with binding tape was tried too, and lost to the coil.
 *
 * Every element here is rendered in every skin and shown only by the desk
 * rules in globals.css, so organic and clean never see any of it. All of
 * it sits inside .wrap and is positioned around it; nothing here is an
 * ancestor of the list, so FLIP's measurements are untouched.
 */
export default function Booklet() {
  return (
    <>
      <div className="book-cover" aria-hidden="true" />
      <div className="book-used" aria-hidden="true" />
      <div className="book-binding" aria-hidden="true" />
    </>
  );
}
