import { syncEvidenceIndex, syncForensicIndex } from './records.mjs';
import { storeOriginals } from './vault.mjs';

const migrations = [
  db => db.exec(`
    CREATE TABLE IF NOT EXISTS accounts(username TEXT PRIMARY KEY,role TEXT NOT NULL,unit TEXT NOT NULL,salt TEXT NOT NULL,verifier BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES accounts(username),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cases(unit TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(unit,id));
    CREATE TABLE IF NOT EXISTS approvals(unit TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(unit,id,version));
    CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY,failures INTEGER NOT NULL,expires INTEGER NOT NULL);
  `),
  db => {
    db.exec(`
      ALTER TABLE accounts ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
      ALTER TABLE cases ADD COLUMN legacy_unit_access INTEGER NOT NULL DEFAULT 0 CHECK(legacy_unit_access IN (0,1));
      UPDATE cases SET legacy_unit_access=1;
      ALTER TABLE cases ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0 CHECK(synthetic IN (0,1));
      CREATE INDEX accounts_unit ON accounts(unit,username) WHERE active=1;
      CREATE TABLE case_assignments(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,username TEXT NOT NULL REFERENCES accounts(username),
        PRIMARY KEY(unit,case_id,username), FOREIGN KEY(unit,case_id) REFERENCES cases(unit,id)
      );
      CREATE INDEX assignments_by_user ON case_assignments(unit,username,case_id);
      CREATE TABLE record_index(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,
        party TEXT NOT NULL,peer TEXT NOT NULL,observed TEXT NOT NULL,session_end TEXT NOT NULL,
        imei TEXT NOT NULL,tower TEXT NOT NULL,ip TEXT NOT NULL,dest_ip TEXT NOT NULL,
        protocol TEXT NOT NULL,session TEXT NOT NULL,port TEXT NOT NULL,data TEXT NOT NULL,
        PRIMARY KEY(unit,case_id,id), FOREIGN KEY(unit,case_id) REFERENCES cases(unit,id)
      );
      CREATE INDEX records_time ON record_index(unit,case_id,observed,id);
      CREATE INDEX records_kind_time ON record_index(unit,case_id,kind,observed,id);
      CREATE INDEX records_party ON record_index(unit,case_id,party,observed);
      CREATE INDEX records_peer ON record_index(unit,case_id,peer,observed);
      CREATE INDEX records_tower ON record_index(unit,case_id,tower,observed);
      CREATE INDEX records_ip ON record_index(unit,case_id,ip,observed);
      CREATE INDEX records_dest_ip ON record_index(unit,case_id,dest_ip,observed);
      CREATE INDEX records_imei ON record_index(unit,case_id,imei,observed);
      CREATE INDEX records_protocol ON record_index(unit,case_id,protocol,observed);
      CREATE INDEX records_session ON record_index(unit,case_id,session,observed);
      CREATE TABLE record_sources(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,record_id TEXT NOT NULL,source_id TEXT NOT NULL,operator TEXT NOT NULL,
        PRIMARY KEY(unit,case_id,record_id,source_id),
        FOREIGN KEY(unit,case_id,record_id) REFERENCES record_index(unit,case_id,id) ON DELETE CASCADE
      );
      CREATE INDEX record_sources_operator ON record_sources(unit,case_id,operator,record_id);
      CREATE TABLE case_activity(
        sequence INTEGER PRIMARY KEY,unit TEXT NOT NULL,case_id TEXT NOT NULL,
        actor TEXT NOT NULL,time TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,
        FOREIGN KEY(unit,case_id) REFERENCES cases(unit,id)
      );
      CREATE INDEX case_activity_by_case ON case_activity(unit,case_id,sequence);
      CREATE TABLE account_activity(
        sequence INTEGER PRIMARY KEY,unit TEXT NOT NULL,actor TEXT NOT NULL,time TEXT NOT NULL,action TEXT NOT NULL,subject TEXT NOT NULL
      );
      CREATE INDEX account_activity_by_unit ON account_activity(unit,sequence);
    `);
    for (const row of db.prepare('SELECT unit,data FROM cases').iterate()) {
      const item=JSON.parse(row.data);
      storeOriginals(db,item.files);
      syncEvidenceIndex(db,row.unit,item);
    }
  },
  db => db.exec(`
    ALTER TABLE cases ADD COLUMN owner TEXT NOT NULL DEFAULT '';
    UPDATE cases SET owner=COALESCE(json_extract(data,'$.owner'),'');
    CREATE INDEX cases_by_owner ON cases(unit,owner,id);
  `),
  db => {
    db.exec(`
      CREATE TABLE source_manifests(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,source_id TEXT NOT NULL,
        name TEXT NOT NULL,kind TEXT NOT NULL,sha256 TEXT NOT NULL,length INTEGER NOT NULL,
        PRIMARY KEY(unit,case_id,source_id), UNIQUE(unit,case_id,sha256),
        FOREIGN KEY(unit,case_id) REFERENCES cases(unit,id)
      );
      CREATE TABLE record_provenance(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,record_id TEXT NOT NULL,source_id TEXT NOT NULL,
        original_row INTEGER NOT NULL,worksheet TEXT NOT NULL DEFAULT '',
        PRIMARY KEY(unit,case_id,record_id,source_id,original_row),
        FOREIGN KEY(unit,case_id,record_id) REFERENCES record_index(unit,case_id,id) ON DELETE CASCADE,
        FOREIGN KEY(unit,case_id,source_id) REFERENCES source_manifests(unit,case_id,source_id)
      );
      CREATE INDEX provenance_by_source ON record_provenance(unit,case_id,source_id,original_row);
      CREATE TABLE tower_index(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,cell_id TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,data TEXT NOT NULL,
        PRIMARY KEY(unit,case_id,cell_id), FOREIGN KEY(unit,case_id) REFERENCES cases(unit,id)
      );
      CREATE TABLE findings_index(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,finding_id TEXT NOT NULL,data TEXT NOT NULL,
        PRIMARY KEY(unit,case_id,finding_id), FOREIGN KEY(unit,case_id) REFERENCES cases(unit,id)
      );
      CREATE TABLE finding_citations(
        unit TEXT NOT NULL,case_id TEXT NOT NULL,finding_id TEXT NOT NULL,record_id TEXT NOT NULL,
        PRIMARY KEY(unit,case_id,finding_id,record_id),
        FOREIGN KEY(unit,case_id,finding_id) REFERENCES findings_index(unit,case_id,finding_id) ON DELETE CASCADE,
        FOREIGN KEY(unit,case_id,record_id) REFERENCES record_index(unit,case_id,id) ON DELETE CASCADE
      );
      CREATE VIEW cdr_records AS SELECT * FROM record_index WHERE kind='CDR';
      CREATE VIEW ipdr_records AS SELECT * FROM record_index WHERE kind='IPDR';
    `);
    for(const row of db.prepare('SELECT unit,data FROM cases').iterate()) {
      syncForensicIndex(db,row.unit,JSON.parse(row.data),true);
    }
  }
];

export function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current > migrations.length) throw new Error('The team database requires a newer version of TRACE-X.');
  for (let i=current;i<migrations.length;i++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('PRAGMA user_version').get().user_version === i) {
        migrations[i](db);
        db.exec('PRAGMA user_version='+ (i+1));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
