import gzip
import os
import re
from collections import Counter
from lxml import etree

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
xml_file_path = os.path.join(REPO_ROOT, "data", "raw", "dblp.xml.gz")
dtd_file_path = os.path.join(REPO_ROOT, "data", "raw", "dblp.dtd")


def load_entity_map(dtd_path):
    dtd = etree.DTD(dtd_path)
    return {entity.name: entity.content for entity in dtd.entities()}


ENTITY_MAP = load_entity_map(dtd_file_path)
ENTITY_PATTERN = re.compile(r'&(\w+);')


def substitute_entities(line):
    return ENTITY_PATTERN.sub(
        lambda m: ENTITY_MAP.get(m.group(1), m.group(0)), line
    )


parser = etree.XMLPullParser(events=('end',), recover=True)
tag_counts = Counter()
line_no = 0
last_error_count = 0
target_found = 0
stopped_making_progress_at = None
CHECK_UP_TO_LINE = 5000000  # stop after this many raw lines for the diagnostic
STOP_AFTER_TARGETS = 200    # or once we've found this many article/inproceedings records

with gzip.open(xml_file_path, 'rt', encoding='iso-8859-1') as f:
    for line in f:
        line_no += 1
        parser.feed(substitute_entities(line))

        errors = parser.error_log
        if len(errors) > last_error_count:
            for e in errors[last_error_count:]:
                print(f"[line {line_no}] PARSER ERROR: {e}")
            last_error_count = len(errors)

        for event, elem in parser.read_events():
            tag_counts[elem.tag] += 1
            if elem.tag in ('article', 'inproceedings'):
                target_found += 1
                parent = elem.getparent()
                if parent is not None:
                    parent.remove(elem)

        if line_no % 20000 == 0:
            print(f"[line {line_no}] target records so far: {target_found}, "
                  f"distinct tags seen: {len(tag_counts)}")

        if line_no >= CHECK_UP_TO_LINE or target_found >= STOP_AFTER_TARGETS:
            break

print("\n--- Summary ---")
print(f"Lines read: {line_no}")
print(f"Target (article/inproceedings) records found: {target_found}")
print(f"Total parser errors logged: {last_error_count}")
print("Tag counts (top 15):")
for tag, c in tag_counts.most_common(15):
    print(f"  {tag}: {c}")
