import gzip
import io
import os
import re
import time
import pandas as pd
from lxml import etree

xml_file_path = "dblp.xml.gz"
dtd_file_path = "dblp.dtd"
output_csv = "dblp_full.csv"


def load_entity_map(dtd_path):
    dtd = etree.DTD(dtd_path)
    return {entity.name: entity.content for entity in dtd.entities()}


ENTITY_MAP = load_entity_map(dtd_file_path)
ENTITY_PATTERN = re.compile(r'&(\w+);')


def substitute_entities(line):
    return ENTITY_PATTERN.sub(
        lambda m: ENTITY_MAP.get(m.group(1), m.group(0)), line
    )


def format_minutes(seconds):
    return f"{seconds / 60:.1f} min"


def parse_dblp_to_csv(source_file, output_csv):
    data = []
    count = 0
    lines_read = 0

    print(f"Starting parser... Loaded {len(ENTITY_MAP)} entities from DTD.")
    print("Running FULL dataset extraction (no limit, no year filter).")

    raw_size = os.path.getsize(source_file)
    raw_f = open(source_file, 'rb')
    gz = gzip.GzipFile(fileobj=raw_f)
    f = io.TextIOWrapper(gz, encoding='iso-8859-1')

    parser = etree.XMLPullParser(events=('end',), recover=True)
    start_time = time.time()

    try:
        for line in f:
            lines_read += 1
            parser.feed(substitute_entities(line))

            for event, elem in parser.read_events():
                parent = elem.getparent()

                # Only direct children of <dblp> are complete top-level records
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
                    if count % 50000 == 0:
                        print(f"Extracted {count} records so far...")

                # Memory cleanup for every top-level record
                elem.clear()
                while elem.getprevious() is not None:
                    del parent[0]

            if lines_read % 500000 == 0:
                elapsed = time.time() - start_time
                bytes_read = raw_f.tell()
                pct = (bytes_read / raw_size) * 100
                rate = bytes_read / elapsed if elapsed > 0 else 0
                remaining = raw_size - bytes_read
                eta = remaining / rate if rate > 0 else 0
                print(
                    f"...progress: {pct:.1f}% "
                    f"({bytes_read / 1e6:.0f}MB / {raw_size / 1e6:.0f}MB), "
                    f"elapsed {format_minutes(elapsed)}, "
                    f"ETA ~{format_minutes(eta)}, "
                    f"records so far: {count}"
                )
    finally:
        f.close()
        raw_f.close()

    df = pd.DataFrame(data)
    df.to_csv(output_csv, index=False)
    total_time = time.time() - start_time
    print(f"\nSuccess! Saved {len(df)} records to '{output_csv}' "
          f"in {format_minutes(total_time)}.")


parse_dblp_to_csv(xml_file_path, output_csv)
