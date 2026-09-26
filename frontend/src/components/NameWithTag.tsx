import { splitName } from '../lib/format';

export const TAG_HELP = 'DBLP tells people who share a name apart with a number';

/** A DBLP name with its disambiguation number ("0002") shown as a small tag rather than as part of the name. */
export function NameWithTag({ name }: { name: string }) {
  const { base, tag } = splitName(name);
  return (
    <>
      {base}
      {tag && (
        <>
          {' '}
          <span className="tag" title={TAG_HELP}>
            {tag}
          </span>
        </>
      )}
    </>
  );
}
