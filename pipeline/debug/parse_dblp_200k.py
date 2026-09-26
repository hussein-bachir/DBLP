import gzip
import os
import re
import pandas as pd
from lxml import etree

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
xml_file_path = os.path.join(REPO_ROOT, "data", "raw", "dblp.xml.gz")
dtd_file_path = os.path.join(REPO_ROOT, "data", "raw", "dblp.dtd")


def load_entity_map(dtd_path):
    """Read the DTD standalone (not via iterparse) and build a lookup
    table of named entities (e.g. 'auml' -> 'ä') defined in it."""
    dtd = etree.DTD(dtd_path)
    return {entity.name: entity.content for entity in dtd.entities()}


ENTITY_MAP = load_entity_map(dtd_file_path)
ENTITY_PATTERN = re.compile(r'&(\w+);')


def substitute_entities(line):
    # Replace only entities we recognize from the DTD; leave standard
    # XML entities (&amp; &lt; &gt; etc.) untouched for the parser itself.
    return ENTITY_PATTERN.sub(
        lambda m: ENTITY_MAP.get(m.group(1), m.group(0)), line
    )


def parse_dblp_to_csv(source_file, output_csv, limit=10000):
    data = []
    count = 0

    print(f"Starting parser... Loaded {len(ENTITY_MAP)} entities from DTD.")

    # No load_dtd / dtd_validation here on purpose -- we already handled
    # entity resolution ourselves above, so the parser doesn't need to
    # touch dblp.dtd at all, which avoids the streaming-DTD bug entirely.
    parser = etree.XMLPullParser(events=('end',), recover=True)

    with gzip.open(source_file, 'rt', encoding='iso-8859-1') as f:
        for line in f:
            parser.feed(substitute_entities(line))

            for event, elem in parser.read_events():
                parent = elem.getparent()

                # Only act on elements that are direct children of <dblp>
                # (i.e. complete top-level records: article, incollection,
                # book, phdthesis, data, etc.) -- ignore their inner
                # sub-elements (title, author...), which close first but
                # aren't top-level records themselves.
                if parent is None or parent.tag != 'dblp':
                    continue

                if elem.tag in ('article', 'inproceedings'):
                    key = elem.get('key')
                    title = elem.findtext('title')
                    year = elem.findtext('year')
                    authors = "; ".join(
                        a.text for a in elem.findall('author') if a.text
                    )

                    data.append({
                        "type": elem.tag,
                        "key": key,
                        "title": title,
                        "year": year,
                        "authors": authors,
                    })

                    count += 1
                    if count % 2000 == 0:
                        print(f"Processed {count} records...")

                # Memory cleanup for EVERY top-level record, regardless of
                # type, so incollection/book/data/etc. don't pile up.
                elem.clear()
                while elem.getprevious() is not None:
                    del parent[0]

                if count >= limit:
                    df = pd.DataFrame(data)
                    df.to_csv(output_csv, index=False)
                    print(f"\nSuccess! Saved {len(df)} records to '{output_csv}'")
                    return

    df = pd.DataFrame(data)
    df.to_csv(output_csv, index=False)
    print(f"\nSuccess! Saved {len(df)} records to '{output_csv}'")


parse_dblp_to_csv(xml_file_path, os.path.join(REPO_ROOT, "data", "processed", "dblp_sample.csv"), limit=5000000)
