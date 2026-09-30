import { t } from '../i18n/index.js'

const DB_NAME = 'pdf-score'
const DB_VERSION = 1
const STORE_SCORES = 'scores'
const STORE_FILES = 'files'

let dbPromise = null

export function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error(t('domain.error.noIndexedDb')))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SCORES)) {
        const store = db.createObjectStore(STORE_SCORES, { keyPath: 'id' })
        store.createIndex('openedAt', 'openedAt')
        store.createIndex('title', 'title')
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES)
    }
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      db.onclose = () => {
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error || new Error(t('domain.error.dbOpenFailed')))
  })
  return dbPromise
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function runTx(db, names, mode, fn) {
  const list = Array.isArray(names) ? names : [names]
  return new Promise((resolve, reject) => {
    let tx
    try {
      tx = db.transaction(list, mode)
    } catch (err) {
      reject(err)
      return
    }
    let result
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error(t('domain.error.txAborted')))
    try {
      result = fn(...list.map((n) => tx.objectStore(n)))
    } catch (err) {
      try {
        tx.abort()
      } catch {}
      reject(err)
    }
  })
}

async function withStore(names, mode, fn) {
  const attempt = async () => runTx(await openDB(), names, mode, fn)
  try {
    return await attempt()
  } catch (err) {
    if (err?.name === 'InvalidStateError' || /closing|closed|not open/i.test(err?.message || '')) {
      dbPromise = null
      return await attempt()
    }
    throw err
  }
}

export async function listScores() {
  const all = await withStore(STORE_SCORES, 'readonly', (s) => wrap(s.getAll()))
  return (all || []).sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0))
}

export async function getScore(id) {
  return withStore(STORE_SCORES, 'readonly', (s) => wrap(s.get(id)))
}

export async function putScore(record) {
  await withStore(STORE_SCORES, 'readwrite', (s) => s.put(record))
  return record
}

export async function patchScore(id, patch) {
  return withStore(STORE_SCORES, 'readwrite', (store) => {
    return new Promise((resolve, reject) => {
      const req = store.get(id)
      req.onsuccess = () => {
        const rec = req.result
        if (!rec) {
          reject(new Error(t('domain.error.scoreNotFound')))
          return
        }
        const next = { ...rec, ...patch }
        store.put(next)
        resolve(next)
      }
      req.onerror = () => reject(req.error)
    })
  })
}

export async function deleteScores(ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  await withStore([STORE_SCORES, STORE_FILES], 'readwrite', (scores, files) => {
    for (const id of list) {
      scores.delete(id)
      files.delete(`${id}/pdf`)
      files.delete(`${id}/audio`)
      files.delete(`${id}/peaks`)
    }
  })
}

export async function putFile(id, kind, data) {
  await withStore(STORE_FILES, 'readwrite', (s) => s.put(data, `${id}/${kind}`))
}

export async function getFile(id, kind) {
  return withStore(STORE_FILES, 'readonly', (s) => wrap(s.get(`${id}/${kind}`)))
}

export async function deleteFile(id, kind) {
  await withStore(STORE_FILES, 'readwrite', (s) => s.delete(`${id}/${kind}`))
}

export async function estimateUsage() {
  try {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      return { usage, quota }
    }
  } catch {}
  return null
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      return await navigator.storage.persist()
    }
  } catch {}
  return false
}
