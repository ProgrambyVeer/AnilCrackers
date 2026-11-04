import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Flame,
  ImagePlus,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { categoryLabel, translate, type TranslationKey } from './lib/i18n'
import { CUSTOMER_INTEREST_STORAGE_KEY, clearInterestQuantities, parseInterestQuantities, serializeInterestQuantities, updateInterestQuantity } from './lib/customer-interest'
import { makeWhatsAppMessage, makeWhatsAppUrl, validateInterest } from './lib/interest'
import { normalizeIndianMobile } from './lib/indian-mobile'
import { captchaProvider, captchaSitekey, protectedSubmissionEnabled, submitProtectedInterest } from './lib/submit-interest'
import { CaptchaChallenge } from './CaptchaChallenge'
import { requireSupabase, supabase, supabaseConfigIssue } from './lib/supabase'
import { describeSupabaseConfigIssue } from './lib/supabase-config'
import { applyImageFallback, classifyCatalogueError, describeCatalogueIssue, productImageSrc, staffErrorMessage, type CatalogueIssue } from './lib/catalogue'
import { getStockStatus, isValidStockValue, type StockStatus } from './lib/stock'
import { demoCatalogueProducts, demoEnquiries, demoProducts, demoProfile, demoShop, demoVendorApplications, demoVendorApplicationEvents, demoVendorProfile } from './lib/demo'
import type {
  Enquiry,
  EnquiryItem,
  EnquiryStatus,
  Language,
  Product,
  PublicCatalogueProduct,
  Profile,
  ShopSettings,
  VendorApplication,
  VendorApplicationEvent,
  UserRole,
} from './types'

const categories = ['Ground', 'Sparklers', 'Aerial', 'Sound', 'Combo', 'Other']
const statuses: EnquiryStatus[] = ['new', 'contacted', 'completed', 'closed']
const DEV_CUSTOMER_PREVIEW = import.meta.env.DEV && !supabase
const DEV_STAFF_PREVIEW = import.meta.env.DEV && (
  !supabase || import.meta.env.VITE_DEV_PORTAL_PREVIEW === 'true'
)

function App() {
  if (!import.meta.env.DEV && supabaseConfigIssue) {
    return <ConfigurationErrorPage message={describeSupabaseConfigIssue(supabaseConfigIssue)} />
  }
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CustomerPage />} />
        <Route path="/vendor" element={<StaffGate role="vendor"><StaffDashboard role="vendor" /></StaffGate>} />
        <Route path="/admin" element={<StaffGate role="superadmin"><StaffDashboard role="superadmin" /></StaffGate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

function CustomerPage() {
  const [initialInterest] = useState(() => {
    try {
      return { quantities: parseInterestQuantities(localStorage.getItem(CUSTOMER_INTEREST_STORAGE_KEY)), failed: false }
    } catch {
      return { quantities: {}, failed: true }
    }
  })
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem('anil-crackers-language') === 'kn' ? 'kn' : 'en'
    } catch {
      return 'en'
    }
  })
  const [needsLanguage, setNeedsLanguage] = useState(() => {
    try {
      return !localStorage.getItem('anil-crackers-language')
    } catch {
      return true
    }
  })
  const [products, setProducts] = useState<PublicCatalogueProduct[]>([])
  const [shop, setShop] = useState<ShopSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<CatalogueIssue | ''>('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [quantities, setQuantities] = useState<Record<string, number>>(initialInterest.quantities)
  const [interestStorageError, setInterestStorageError] = useState(initialInterest.failed)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedReference, setSavedReference] = useState('')
  const [whatsAppUrl, setWhatsAppUrl] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaAttempt, setCaptchaAttempt] = useState(0)

  const t = (key: TranslationKey) => translate(language, key)

  useEffect(() => {
    let active = true
    async function loadCatalogue() {
      setLoading(true)
      setLoadError('')
      try {
        if (DEV_CUSTOMER_PREVIEW) {
          setShop(demoShop)
          setProducts(demoCatalogueProducts)
          return
        }
        const client = requireSupabase()
        const [{ data: settings, error: settingsError }, { data: productRows, error: productsError }] = await Promise.all([
          client.from('shop_settings').select('*').eq('id', 1).maybeSingle(),
          client.from('public_catalogue_products').select('*').order('sort_order').order('name_en'),
        ])
        if (settingsError) throw settingsError
        if (productsError) throw productsError
        if (!active) return
        setShop(settings)
        setProducts(productRows ?? [])
      } catch (error) {
        if (!active) return
        const issue = classifyCatalogueError(error)
        console.error(`[catalogue] ${issue}: ${describeCatalogueIssue(issue)}`)
        setLoadError(issue)
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadCatalogue()
    return () => { active = false }
  }, [])

  function persistInterest(next: Record<string, number>) {
    try {
      localStorage.setItem(CUSTOMER_INTEREST_STORAGE_KEY, serializeInterestQuantities(next))
      setInterestStorageError(false)
    } catch {
      setInterestStorageError(true)
    }
  }

  const filteredProducts = useMemo(() => products.filter((product) => {
    const categoryMatches = category === 'All' || product.category === category
    const needle = query.trim().toLocaleLowerCase()
    const textMatches = !needle || [
      product.name_en,
      product.name_kn,
      product.description_en,
      product.description_kn,
      product.category,
    ].some((value) => value.toLocaleLowerCase().includes(needle))
    return categoryMatches && textMatches
  }), [category, products, query])

  const interestLines = useMemo(() => products
    .filter((product) => quantities[product.id] > 0)
    .map((product) => ({ product, quantity: quantities[product.id] })), [products, quantities])

  const count = interestLines.reduce((total, line) => total + line.quantity, 0)
  const indicativeTotal = interestLines.every(({ product }) => product.selling_price !== null)
    ? interestLines.reduce((total, line) => total + (line.product.selling_price ?? 0) * line.quantity, 0)
    : null

  function chooseLanguage(next: Language) {
    setLanguage(next)
    setNeedsLanguage(false)
    try {
      localStorage.setItem('anil-crackers-language', next)
    } catch {
      setFormError(t('errorGeneric'))
    }
  }

  function changeQuantity(productId: string, delta: number) {
    if (saving || savedReference) return
    const product = products.find((item) => item.id === productId)
    const selectedVendorId = interestLines[0]?.product.vendor_id
    if (delta > 0 && product && selectedVendorId && product.vendor_id !== selectedVendorId) {
      setFormError(t('singleVendorError'))
      return
    }
    const next = updateInterestQuantity(quantities, productId, delta)
    setQuantities(next)
    persistInterest(next)
    setFormError('')
  }

  function clearInterestList() {
    if (saving || savedReference) return
    const next = clearInterestQuantities()
    setQuantities(next)
    persistInterest(next)
  }

  async function submitInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || savedReference) return
    setFormError('')
    const validation = validateInterest(name, phone, interestLines)
    if (validation) {
      const keys = { name: 'nameError', phone: 'phoneError', items: 'itemsError', quantity: 'quantityError', vendor: 'singleVendorError' } as const
      setFormError(t(keys[validation]))
      return
    }
    if (!shop?.is_active) {
      setFormError(t('unavailable'))
      return
    }
    if (DEV_CUSTOMER_PREVIEW) {
      setFormError('Development preview only: this interest enquiry was not submitted or saved. Configure Supabase to enable submissions.')
      return
    }
    if (!protectedSubmissionEnabled) {
      setFormError(t('submissionUnavailable'))
      return
    }
    if (!captchaToken) {
      setFormError(t('captchaRequired'))
      return
    }
    setSaving(true)
    try {
      const data = await submitProtectedInterest({
        customer_name: name.trim(),
        customer_phone: phone.trim(),
        items: interestLines.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
        captcha_token: captchaToken,
      })
      const url = makeWhatsAppUrl(data.whatsapp_number, name.trim(), phone.trim(), interestLines, language, data.reference_code)
      setSavedReference(data.reference_code)
      setWhatsAppUrl(url)
    } catch (error) {
      setFormError(localizeSubmissionError(error, language))
    } finally {
      setCaptchaToken('')
      setCaptchaAttempt((attempt) => attempt + 1)
      setSaving(false)
    }
  }

  const shopName = shop?.shop_name || 'Anil Crackers'

  return (
    <div className="customer-page" lang={language === 'kn' ? 'kn' : 'en'}>
      {DEV_CUSTOMER_PREVIEW ? <div className="customer-preview-banner"><span>DEVELOPMENT PREVIEW · SAMPLE CATALOGUE · NO DATABASE ACCESS</span><DevConfigNotice /><DevPortalLinks /></div> : null}
      <header className="customer-header">
        <a className="brand-lockup" href="#" aria-label={shopName}>
          <span className="brand-mark">{shop?.logo_url ? <img src={shop.logo_url} alt="" /> : <Flame size={20} />}</span>
          <span><strong>{shopName}</strong><small>{t('tagline')}</small></span>
        </a>
        <nav className="customer-nav">
          <a href="#catalogue">{t('catalogue')}</a>
          <a className="interest-nav" href="#interest"><ShoppingBasket size={17} /> {t('interestList')} <span>{count}</span></a>
          <LanguageSwitch language={language} label={t('language')} onChange={chooseLanguage} />
        </nav>
      </header>

      <main>
        <section className="customer-hero">
          <div className="hero-backdrop" />
          <div className="hero-content">
            <div className="season-label"><Sparkles size={14} /> DEEPAVALI 2026</div>
            <p className="hero-kannada">{language === 'en' ? t('greetingKannada') : t('greetingKannada')}</p>
            <h1>{t('greeting')}</h1>
            <p className="hero-copy">{shop?.description || t('heroCopy')}</p>
            <a className="button button-gold" href="#catalogue">{t('explore')} <ArrowRight size={17} /></a>
          </div>
          <div className="hero-caption"><span className="caption-dot" /> {t('heroCaption')}</div>
        </section>

        <section className="category-preview" aria-label={t('festiveCategories')}>
          {['Ground', 'Sparklers', 'Aerial', 'Sound'].map((nameInCategory, index) => (
            <button key={nameInCategory} className="category-tile" onClick={() => {
              setCategory(nameInCategory)
              document.getElementById('catalogue')?.scrollIntoView({ behavior: 'smooth' })
            }}>
              <span className={`category-icon category-icon-${index}`}><Sparkles size={18} /></span>
              <span>{categoryLabel(language, nameInCategory)}</span>
              <ArrowUpRight size={14} />
            </button>
          ))}
        </section>

        <section className="catalogue-section" id="catalogue">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('tagline')}</span>
              <h2>{t('catalogue')}</h2>
              <p>{t('catalogueCopy')}</p>
            </div>
            <div className="catalogue-search">
              <Search size={17} />
              <input aria-label={t('search')} placeholder={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>

          <div className="category-filter">
            {['All', ...categories].map((item) => (
              <button key={item} className={category === item ? 'filter-chip active' : 'filter-chip'} onClick={() => setCategory(item)}>
                {item === 'All' ? t('allCategories') : categoryLabel(language, item)}
              </button>
            ))}
          </div>

          {loading ? <div className="catalogue-message"><span className="spinner" />{t('loading')}</div> : null}
          {!loading && loadError ? (
            <div className="catalogue-message error-message" role="alert"><CircleAlert size={20} /><span>{import.meta.env.DEV ? `Live catalogue unavailable (development diagnostic): ${describeCatalogueIssue(loadError)}` : loadError === 'not-configured' ? t('configError') : t('loadError')}</span></div>
          ) : null}
          {!loading && !loadError && !shop ? <div className="catalogue-message">{t('unavailable')}</div> : null}
          {!loading && !loadError && shop && !shop.is_active ? <div className="catalogue-message">{t('unavailable')}</div> : null}
          {!loading && !loadError && shop?.is_active && filteredProducts.length === 0 ? (
            <div className="catalogue-message empty-catalogue"><Package size={22} /><strong>{t('noProducts')}</strong><span>{t('noProductsCopy')}</span></div>
          ) : null}
          {!loading && !loadError && shop?.is_active && filteredProducts.length > 0 ? (
            <div className="product-grid">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  language={language}
                  stockStatus={product.stock_status}
                  sample={DEV_CUSTOMER_PREVIEW}
                  quantity={quantities[product.id] ?? 0}
                  disabled={saving || Boolean(savedReference)}
                  onAdd={() => changeQuantity(product.id, 1)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section className="interest-section" id="interest">
          <div className="interest-intro">
            <span className="interest-icon"><ShoppingBasket size={22} /></span>
            <div><span className="eyebrow">{t('interestOnly')}</span><h2>{t('interestList')}</h2></div>
            <span className="interest-count">{count} {count === 1 ? t('product') : t('products')}</span>
          </div>
          <div className="interest-content">
            {interestLines.length === 0 ? (
              <div className="empty-interest"><Sparkles size={26} /><strong>{t('emptyInterest')}</strong><span>{t('emptyInterestCopy')}</span></div>
            ) : (
              <>
                <div className="interest-summary">
                  <strong>{t('selectedSummary')}</strong>
                  <span>{interestLines.length} {t('uniqueProducts')} · {count} {t('totalQuantities')}</span>
                  <button type="button" className="text-button" disabled={saving || Boolean(savedReference)} onClick={clearInterestList}>{t('clearInterest')}</button>
                </div>
                <div className="interest-lines">
                  {interestLines.map(({ product, quantity }) => (
                    <div className="interest-line" key={product.id}>
                      <img src={productImageSrc(product.image_url)} onError={applyImageFallback} alt="" />
                      <div className="interest-line-name">
                        <strong>{language === 'kn' ? product.name_kn || product.name_en : product.name_en}</strong>
                        <span>{priceLabel(product, language)}</span>
                      </div>
                      <QuantityControl quantity={quantity} disabled={saving || Boolean(savedReference)} decreaseLabel={t('decreaseQuantity')} increaseLabel={t('increaseQuantity')} onMinus={() => changeQuantity(product.id, -1)} onPlus={() => changeQuantity(product.id, 1)} />
                      <button className="icon-button remove-button" disabled={saving || Boolean(savedReference)} aria-label={`${t('removeProduct')} ${product.name_en}`} onClick={() => changeQuantity(product.id, -quantity)}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <div className="interest-total"><span>{t('indicativeTotal')}</span><strong>{indicativeTotal === null ? '—' : formatPrice(indicativeTotal)}</strong></div>
              </>
            )}

            {interestLines.length > 0 ? (
              <form className="interest-form" onSubmit={(event) => void submitInterest(event)} noValidate>
                {interestStorageError ? <p className="privacy-note storage-warning" role="status">{language === 'kn' ? 'ಈ ಸಾಧನದಲ್ಲಿ ಆಸಕ್ತಿ ಪಟ್ಟಿಯನ್ನು ಉಳಿಸಲಾಗಲಿಲ್ಲ.' : 'Your interest list could not be saved in this browser.'}</p> : null}
                <div className="form-grid">
                  <label>{t('name')}<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('namePlaceholder')} maxLength={100} disabled={saving || Boolean(savedReference)} /></label>
                  <label>{t('phone')}<input autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={t('phonePlaceholder')} maxLength={16} disabled={saving || Boolean(savedReference)} /></label>
                </div>
                <p className="privacy-note"><ShieldCheck size={15} />{t('privacyNote')}</p>
                <div className="customer-disclaimer">{t('enquiryNotice')}</div>
                <details className="message-preview">
                  <summary>{t('previewMessage')} <ChevronDown size={15} /></summary>
                  <pre>{makeWhatsAppMessage(name.trim() || '…', phone.trim() || '…', interestLines, language, savedReference || undefined)}</pre>
                </details>
                {formError ? <p className="form-error" role="alert"><CircleAlert size={16} />{formError}</p> : null}
                {!savedReference && !DEV_CUSTOMER_PREVIEW ? (
                  protectedSubmissionEnabled && (captchaProvider === 'turnstile' || captchaProvider === 'hcaptcha')
                    ? <CaptchaChallenge key={captchaAttempt} provider={captchaProvider} sitekey={captchaSitekey} language={language} onToken={setCaptchaToken} />
                    : <p className="form-error" role="status">{t('submissionUnavailable')}</p>
                ) : null}
                {savedReference ? (
                  <div className="saved-panel" role="status">
                    <span className="saved-check"><Check size={19} /></span>
                    <div><strong>{t('saved')} · {savedReference}</strong><p>{t('savedCopy')}</p></div>
                    {whatsAppUrl ? <a className="button button-whatsapp" href={whatsAppUrl} target="_blank" rel="noreferrer"><MessageCircle size={17} />{t('openWhatsApp')}</a> : null}
                    <p className="whatsapp-fallback">{t('whatsappFallback')}</p>
                  </div>
                ) : (
                  <button className="button button-submit" type="submit" disabled={saving || (!DEV_CUSTOMER_PREVIEW && (!protectedSubmissionEnabled || !captchaToken))}>
                    {saving ? <><span className="spinner spinner-dark" />{t('submitting')}</> : <><MessageCircle size={18} />{t('submitInterest')}<ArrowRight size={17} /></>}
                  </button>
                )}
              </form>
            ) : null}
          </div>
        </section>
      </main>
      <footer className="customer-footer">
        <a className="brand-lockup footer-brand" href="#"><span className="brand-mark">{shop?.logo_url ? <img src={shop.logo_url} alt="" /> : <Flame size={17} />}</span><strong>{shopName}</strong></a>
        <p>{shop?.address ? `${shop.address} · ` : ''}{t('footerLine')} <span>·</span> {t('disclaimer')}</p>
        <div className="staff-links"><Link to="/vendor">{t('vendor')}</Link><Link to="/admin">{t('admin')}</Link></div>
      </footer>
      {needsLanguage ? <LanguageDialog language={language} onChoose={chooseLanguage} /> : null}
    </div>
  )
}

function ProductCard({ product, language, quantity, disabled, onAdd, stockStatus, sample = false }: {
  product: PublicCatalogueProduct
  language: Language
  stockStatus: StockStatus
  quantity: number
  disabled: boolean
  onAdd: () => void
  sample?: boolean
}) {
  const name = language === 'kn' ? product.name_kn || product.name_en : product.name_en
  const description = language === 'kn' ? product.description_kn || product.description_en : product.description_en
  return (
    <article className="product-card" data-catalogue-source={sample ? 'sample' : 'live'}>
      <div className="product-image-wrap">
        <img src={productImageSrc(product.image_url)} onError={applyImageFallback} alt={name} loading="lazy" />
        <span className="product-category">{categoryLabel(language, product.category)}</span>
        {sample ? <span className="product-sample-tag">Sample</span> : null}
        <span className={`stock-badge product-stock stock-${stockStatus}`}>{translate(language, stockStatus === 'in-stock' ? 'inStock' : stockStatus === 'low-stock' ? 'lowStock' : 'outOfStock')}</span>
        {quantity > 0 ? <span className="product-added"><Check size={13} /> {quantity}</span> : null}
      </div>
      <div className="product-card-body">
        <h3>{name}</h3>
        <p>{description || categoryLabel(language, product.category)}</p>
        <div className="product-card-bottom">
          <div className="product-price">{product.selling_price !== null ? <strong>{formatPrice(product.selling_price)}</strong> : <span>{translate(language, 'priceUnavailable')}</span>}
            {product.mrp !== null && product.selling_price !== null && product.mrp > product.selling_price ? <del>{formatPrice(product.mrp)}</del> : null}
          </div>
          <button className={quantity ? 'add-button added' : 'add-button'} disabled={disabled} onClick={onAdd} aria-label={`${translate(language, 'addInterest')}: ${name}`}>
            {quantity ? <Check size={17} /> : <Plus size={17} />}
          </button>
        </div>
      </div>
    </article>
  )
}

function QuantityControl({ quantity, disabled, decreaseLabel, increaseLabel, onMinus, onPlus }: {
  quantity: number
  disabled: boolean
  decreaseLabel: string
  increaseLabel: string
  onMinus: () => void
  onPlus: () => void
}) {
  return (
    <div className="quantity-control">
      <button className="icon-button" aria-label={decreaseLabel} disabled={disabled} onClick={onMinus}><Minus size={14} /></button>
      <span>{quantity}</span>
      <button className="icon-button" aria-label={increaseLabel} disabled={disabled} onClick={onPlus}><Plus size={14} /></button>
    </div>
  )
}

function LanguageSwitch({ language, label, onChange }: { language: Language; label: string; onChange: (language: Language) => void }) {
  return (
    <div className="language-switch" aria-label={label}>
      <button className={language === 'en' ? 'selected' : ''} onClick={() => onChange('en')}>English</button>
      <span />
      <button className={language === 'kn' ? 'selected' : ''} onClick={() => onChange('kn')}>ಕನ್ನಡ</button>
    </div>
  )
}

function DevConfigNotice() {
  if (!supabaseConfigIssue) return null
  return <span className="dev-config-notice" role="status">Supabase not connected: {describeSupabaseConfigIssue(supabaseConfigIssue)}</span>
}

function ConfigurationErrorPage({ message }: { message: string }) {
  return (
    <div className="staff-screen">
      <section className="signin-card" role="alert">
        <span className="staff-logo"><ShieldCheck size={20} /></span>
        <span className="eyebrow">ANIL CRACKERS · CONFIGURATION</span>
        <h1>Site configuration required</h1>
        <p>The catalogue cannot connect to its database. {message}</p>
        <p>Update the deployment environment variables and rebuild. No secret values are shown here.</p>
      </section>
    </div>
  )
}

function DevPortalLinks({ activeRole }: { activeRole?: UserRole }) {
  return (
    <div className="dev-portal-links" aria-label="Development portal links">
      <Link to="/">Customer portal</Link>
      <Link className={activeRole === 'vendor' ? 'current' : ''} to="/vendor">Vendor preview</Link>
      <Link className={activeRole === 'superadmin' ? 'current' : ''} to="/admin">Admin preview</Link>
    </div>
  )
}

function LanguageDialog({ language, onChoose }: { language: Language; onChoose: (language: Language) => void }) {
  const t = (key: TranslationKey) => translate(language, key)
  return (
    <div className="language-overlay" role="dialog" aria-modal="true" aria-labelledby="language-title">
      <div className="language-dialog">
        <span className="modal-spark"><Sparkles size={23} /></span>
        <span className="eyebrow">{t('greetingKannada')}</span>
        <h2 id="language-title">{t('languageTitle')}</h2>
        <p>{t('languageCopy')}</p>
        <div className="language-choices">
          <button onClick={() => onChoose('en')}><span>English</span><ArrowRight size={17} /></button>
          <button onClick={() => onChoose('kn')}><span>ಕನ್ನಡ</span><ArrowRight size={17} /></button>
        </div>
      </div>
    </div>
  )
}

function priceLabel(product: Pick<Product, 'selling_price'>, language: Language) {
  if (product.selling_price === null) return translate(language, 'priceUnavailable')
  return formatPrice(product.selling_price)
}

function localizeSubmissionError(error: unknown, language: Language) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'rate_limited') return translate(language, 'rateLimited')
  if (message === 'captcha_failed' || message === 'captcha_required') return translate(language, 'captchaRequired')
  if (message === 'captcha_unavailable') return translate(language, 'captchaUnavailable')
  if (message === 'submission_unavailable' || message === 'client_address_unavailable' || message === 'database_unavailable') return translate(language, 'submissionUnavailable')
  if (message === 'invalid_phone') return translate(language, 'phoneError')
  if (message.includes('vendor WhatsApp')) return translate(language, 'vendorWhatsappMissing')
  if (message.includes('one approved vendor')) return translate(language, 'singleVendorError')
  if (message.includes('not configured')) return translate(language, 'whatsappMissing')
  if (message.includes('no longer available') || message.includes('product is invalid')) return translate(language, 'productUnavailable')
  if (message.includes('30 products')) return translate(language, 'maxItemsError')
  if (message.includes('only appear once') || message.includes('at least one product')) return translate(language, 'itemsError')
  if (message.includes('quantity')) return translate(language, 'quantityError')
  if (message.includes('phone number')) return translate(language, 'phoneError')
  if (message.includes('name between')) return translate(language, 'nameError')
  if (message.includes('shop is not currently')) return translate(language, 'unavailable')
  return translate(language, 'submitError')
}

function formatPrice(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function StaffGate({ role, children }: { role: UserRole; children: React.ReactNode }) {
  const location = useLocation()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [application, setApplication] = useState<VendorApplication | null>(null)
  const [hasSession, setHasSession] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authName, setAuthName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    if (DEV_STAFF_PREVIEW || !supabase) return
    let active = true
    async function loadProfile() {
      try {
        const { data: { session }, error: sessionError } = await supabase!.auth.getSession()
        if (sessionError) throw sessionError
        if (!session) {
          if (active) {
            setHasSession(false)
            setProfile(null)
            setApplication(null)
            setLoading(false)
          }
          return
        }
        if (active) setHasSession(true)
        if (active) {
          setAuthEmail(session.user.email ?? '')
          setAuthName(String(session.user.user_metadata.full_name ?? session.user.user_metadata.name ?? ''))
        }
        const { data, error: profileError } = await supabase!.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
        if (profileError) throw profileError
        let applicationData: VendorApplication | null = null
        if (!data && role === 'vendor') {
          const { data: row, error: applicationError } = await supabase!.from('vendor_applications').select('*').eq('id', session.user.id).maybeSingle()
          if (applicationError) throw applicationError
          applicationData = row
        }
        if (active) {
          setProfile(data)
          setApplication(applicationData)
          setLoading(false)
        }
      } catch (cause) {
        if (active) {
          setError(staffErrorMessage(cause, 'Unable to verify this account.'))
          setLoading(false)
        }
      }
    }
    void loadProfile()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      setLoading(true)
      void loadProfile()
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [role])

  if (DEV_STAFF_PREVIEW) {
    return <StaffDashboard role={role} preview />
  }

  async function signIn() {
    setError('')
    setSigningIn(true)
    try {
      const client = requireSupabase()
      const { error: authError } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}${location.pathname}` },
      })
      if (authError) throw authError
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start Google sign-in.')
      setSigningIn(false)
    }
  }

  if (!supabase) {
    return <AccessMessage title="Staff access needs setup" message={translate('en', 'supabaseMissing')} back />
  }

  if (loading) return <div className="staff-loading"><span className="spinner" />Checking account access…</div>
  if (error && !profile) {
    return <AccessMessage title="Unable to verify access" message={error} back />
  }
  if (hasSession && !profile) {
    if (role === 'vendor') {
      return <VendorApplicationPage application={application} authEmail={authEmail} authName={authName} onSubmitted={setApplication} />
    }
    return <AccessMessage title="Account not provisioned" message="This Google account has no assigned staff role yet. Vendor applications are available from the vendor portal." back />
  }
  if (!profile) {
    return <SignInPage role={role} error={error} signingIn={signingIn} onSignIn={() => void signIn()} />
  }
  if (!profile.is_active || profile.role !== role) {
    return <AccessMessage title={translate('en', 'accessDenied')} message={!profile.is_active ? 'This account has been disabled. Contact the platform administrator.' : 'Use the staff area assigned to your account.'} back />
  }
  return <>{children}</>
}

function AccessMessage({ title, message, back = false }: { title: string; message: string; back?: boolean }) {
  return (
    <div className="staff-screen">
      <section className="signin-card"><span className="staff-logo"><ShieldCheck size={20} /></span><h1>{title}</h1><p>{message}</p>{back ? <Link className="button button-dark" to="/">Back to customer site</Link> : null}</section>
    </div>
  )
}

function SignInPage({ role, error, signingIn, onSignIn }: { role: UserRole; error: string; signingIn: boolean; onSignIn: () => void }) {
  return (
    <div className="staff-screen">
      <section className="signin-card">
        <span className="staff-logo"><ShieldCheck size={20} /></span>
        <span className="eyebrow">ANIL CRACKERS · {role === 'vendor' ? 'VENDOR' : 'SUPER ADMIN'}</span>
        <h1>Protected staff area</h1>
        <p>Sign in with the Google account assigned to this {role === 'vendor' ? 'vendor' : 'Super Admin'} role.</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button-dark sign-in-button" onClick={onSignIn} disabled={signingIn}>
          {signingIn ? <span className="spinner" /> : <GoogleMark />} {translate('en', 'signIn')}
        </button>
        <Link className="back-link" to="/">Return to customer site</Link>
      </section>
    </div>
  )
}

function VendorApplicationPage({ application, authEmail, authName, onSubmitted }: {
  application: VendorApplication | null
  authEmail: string
  authName: string
  onSubmitted: (application: VendorApplication) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canApply = !application || application.status === 'rejected'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    const phone = normalizeIndianMobile(String(form.get('phone') ?? ''))
    if (!phone) {
      setError('Enter a valid 10-digit Indian mobile number, optionally prefixed with +91.')
      setSaving(false)
      return
    }
    try {
      const { data, error: submitError } = await requireSupabase().rpc('submit_vendor_application', {
        p_business_name: String(form.get('business_name') ?? '').trim(),
        p_owner_name: String(form.get('owner_name') ?? '').trim(),
        p_phone: phone,
        p_location: String(form.get('location') ?? '').trim(),
      })
      if (submitError) throw submitError
      if (!data) throw new Error('The application was not returned by the server.')
      onSubmitted(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit the vendor application.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="staff-screen">
      <section className="signin-card vendor-application-card">
        <span className="staff-logo"><Users size={20} /></span>
        <span className="eyebrow">ANIL CRACKERS · VENDOR REGISTRATION</span>
        {application && !canApply ? (
          <>
            <h1>{application.status === 'pending' ? 'Application under review' : 'Vendor application status'}</h1>
            <p>{application.status === 'pending'
              ? 'Your application is pending Super Admin review. Product and enquiry access remains disabled until approval.'
              : `Application status: ${application.status}.`}</p>
            {application.rejection_reason ? <p className="application-rejection">Reason: {application.rejection_reason}</p> : null}
            <dl className="application-summary">
              <div><dt>Business</dt><dd>{application.business_name}</dd></div>
              <div><dt>Owner</dt><dd>{application.owner_name}</dd></div>
              <div><dt>Submitted</dt><dd>{formatDate(application.submitted_at, true)}</dd></div>
              {application.reviewed_at ? <div><dt>Reviewed</dt><dd>{formatDate(application.reviewed_at, true)}</dd></div> : null}
            </dl>
          </>
        ) : (
          <>
            <h1>{application ? 'Update your vendor application' : 'Apply for vendor access'}</h1>
            <p>Sign-in identifies your account; a Super Admin must approve your application before you can manage products or view customer enquiries.</p>
            <form className="vendor-application-form" onSubmit={(event) => void submit(event)}>
              <FormField name="business_name" label="Business name" defaultValue={application?.business_name} required />
              <FormField name="owner_name" label="Owner name" defaultValue={application?.owner_name || authName} required />
              <FormField name="phone" label="Business phone (Indian mobile; used for WhatsApp enquiries)" defaultValue={application?.phone} required />
              <FormField name="location" label="Business location" defaultValue={application?.location} required />
              <label className="field-label">Google account email<input value={application?.email || authEmail} readOnly /></label>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              <button className="button button-primary" type="submit" disabled={saving}>{saving ? <span className="spinner spinner-dark" /> : <Check size={16} />}{application ? 'Resubmit application' : 'Submit application'}</button>
            </form>
          </>
        )}
        <Link className="back-link" to="/">Return to customer site</Link>
      </section>
    </div>
  )
}

function GoogleMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true" className="google-mark"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" /><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94a11.1 11.1 0 0 1-4.8 7.3l7.73 5.99c4.51-4.17 7.11-10.31 7.11-17.76Z" /><path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a23.9 23.9 0 0 0 0 21.56l7.98-6.19Z" /><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.8l-7.73-5.99c-2.14 1.44-4.89 2.3-8.17 2.3-6.26 0-11.57-4.22-13.46-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" /></svg>
}

type DashboardTab = 'overview' | 'products' | 'enquiries' | 'vendors' | 'settings'
type EnquiryWithItems = Enquiry & { items: EnquiryItem[] }

function StaffDashboard({ role, preview = false }: { role: UserRole; preview?: boolean }) {
  const isAdmin = role === 'superadmin'
  const [tab, setTab] = useState<DashboardTab>('overview')
  const [profile, setProfile] = useState<Profile | null>(() => preview ? demoProfile(role) : null)
  const [products, setProducts] = useState<Product[]>(() => preview ? [...demoProducts] : [])
  const [enquiries, setEnquiries] = useState<EnquiryWithItems[]>(() => preview ? [...demoEnquiries] : [])
  const [applications, setApplications] = useState<VendorApplication[]>(() => preview ? [...demoVendorApplications] : [])
  const [applicationEvents, setApplicationEvents] = useState<VendorApplicationEvent[]>(() => preview ? [...demoVendorApplicationEvents] : [])
  const [vendor, setVendor] = useState<Profile | null>(() => preview && isAdmin ? demoVendorProfile : null)
  const [settings, setSettings] = useState<ShopSettings | null>(() => preview ? demoShop : null)
  const [loading, setLoading] = useState(!preview)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null | 'new'>(null)

  const reload = useCallback(async () => {
    if (preview) return
    const client = supabase
    if (!client) return
    try {
      const { data: { session }, error: sessionError } = await client.auth.getSession()
      if (sessionError) throw sessionError
      if (!session) throw new Error('Your session expired. Sign in again.')
      setError('')
      const [profileResult, productsResult, enquiriesResult, itemResult, settingsResult] = await Promise.all([
        client.from('profiles').select('*').eq('id', session.user.id).single(),
        client.from('products').select('*').order('sort_order').order('name_en'),
        client.from('enquiries').select('*').order('created_at', { ascending: false }),
        client.from('enquiry_items').select('*'),
        client.from('shop_settings').select('*').eq('id', 1).maybeSingle(),
      ])
      if (profileResult.error) throw profileResult.error
      if (productsResult.error) throw productsResult.error
      if (enquiriesResult.error) throw enquiriesResult.error
      if (itemResult.error) throw itemResult.error
      if (settingsResult.error) throw settingsResult.error
      setProfile(profileResult.data)
      setProducts(productsResult.data ?? [])
      setSettings(settingsResult.data)
      const itemsByEnquiry = new Map<string, EnquiryItem[]>()
      for (const item of itemResult.data ?? []) {
        itemsByEnquiry.set(item.enquiry_id, [...(itemsByEnquiry.get(item.enquiry_id) ?? []), item])
      }
      setEnquiries((enquiriesResult.data ?? []).map((enquiry) => ({ ...enquiry, items: itemsByEnquiry.get(enquiry.id) ?? [] })))
      if (isAdmin) {
        const [vendorResult, applicationsResult, eventsResult] = await Promise.all([
          client.from('profiles').select('*').eq('role', 'vendor').limit(1),
          client.from('vendor_applications').select('*').order('submitted_at', { ascending: false }),
          client.from('vendor_application_events').select('*').order('created_at', { ascending: false }).limit(100),
        ])
        if (vendorResult.error) throw vendorResult.error
        if (applicationsResult.error) throw applicationsResult.error
        if (eventsResult.error) throw eventsResult.error
        setVendor(vendorResult.data?.[0] ?? null)
        setApplications(applicationsResult.data ?? [])
        setApplicationEvents(eventsResult.data ?? [])
      }
    } catch (cause) {
      setError(staffErrorMessage(cause, 'Unable to load dashboard data.'))
    } finally {
      setLoading(false)
    }
  }, [isAdmin, preview])

  useEffect(() => {
    void Promise.resolve().then(reload)
  }, [reload])

  async function signOut() {
    if (preview) {
      setNotice('Development preview only. No account is signed in.')
      return
    }
    try {
      const { error: signOutError } = await requireSupabase().auth.signOut()
      if (signOutError) throw signOutError
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign out.')
    }
  }

  async function updateProduct(product: Product, changes: Partial<Omit<Product, 'id' | 'created_at' | 'updated_at'>>) {
    if (preview) {
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, ...changes, updated_at: new Date().toISOString() } : item))
      setNotice('Preview only: product changes are held in memory and were not saved to Supabase.')
      return
    }
    try {
      const { error: updateError } = await requireSupabase().from('products').update(changes).eq('id', product.id)
      if (updateError) throw updateError
      setNotice(translate('en', 'savedChanges'))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update product.')
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(translate('en', 'deleteConfirm'))) return
    if (preview) {
      setProducts((current) => current.filter((item) => item.id !== product.id))
      setNotice('Preview only: product removed from this in-memory preview.')
      return
    }
    try {
      const client = requireSupabase()
      const { error: deleteError } = await client.from('products').delete().eq('id', product.id)
      if (deleteError) throw deleteError
      if (product.image_url && profile?.role === 'vendor') {
        const objectPath = storagePathFromPublicUrl(product.image_url)
        if (objectPath && isOwnedVendorImagePath(objectPath, profile.id)) {
          const { error: storageError } = await client.storage.from('product-images').remove([objectPath])
          if (storageError) throw new Error(`Product deleted, but image cleanup failed: ${storageError.message}`)
        }
      }
      setNotice('Product deleted. Existing enquiry snapshots are retained.')
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete product.')
      await reload()
    }
  }

  async function updateEnquiryStatus(enquiry: Enquiry, status: EnquiryStatus) {
    if (preview) {
      setEnquiries((current) => current.map((item) => item.id === enquiry.id ? { ...item, status, updated_at: new Date().toISOString() } : item))
      setNotice('Preview only: enquiry status is held in memory.')
      return
    }
    try {
      const { error: updateError } = await requireSupabase().from('enquiries').update({ status }).eq('id', enquiry.id)
      if (updateError) throw updateError
      setEnquiries((current) => current.map((item) => item.id === enquiry.id ? { ...item, status } : item))
      setNotice(translate('en', 'savedChanges'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update enquiry status.')
    }
  }

  async function toggleVendor() {
    if (!vendor) return
    await changeVendorAccess(vendor, !vendor.is_active)
  }

  async function changeVendorAccess(target: Profile | VendorApplication, isActive: boolean) {
    const targetId = target.id
    if (preview) {
      const updatedAt = new Date().toISOString()
      setVendor((current) => current?.id === targetId ? { ...current, is_active: isActive } : current)
      setApplications((current) => current.map((item) => item.id === targetId
        ? { ...item, status: isActive ? 'approved' : 'suspended', reviewed_at: updatedAt, updated_at: updatedAt }
        : item))
      setApplicationEvents((current) => [{
        id: Date.now(),
        application_id: targetId,
        actor_id: profile?.id ?? null,
        action: isActive ? 'reactivated' : 'suspended',
        reason: null,
        created_at: updatedAt,
      }, ...current])
      setNotice('Preview only: vendor access was not changed in Supabase.')
      return
    }
    try {
      const { error: updateError } = await requireSupabase().rpc('set_vendor_access', { p_vendor_id: targetId, p_is_active: isActive })
      if (updateError) throw updateError
      setNotice(translate('en', 'savedChanges'))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update vendor access.')
    }
  }

  async function reviewApplication(application: VendorApplication, decision: 'approve' | 'reject', reason = '') {
    const updatedAt = new Date().toISOString()
    if (preview) {
      setApplications((current) => current.map((item) => item.id === application.id ? {
        ...item,
        status: decision === 'approve' ? 'approved' : 'rejected',
        rejection_reason: decision === 'reject' ? reason : null,
        reviewed_at: updatedAt,
        reviewed_by: profile?.id ?? null,
        updated_at: updatedAt,
      } : item))
      setApplicationEvents((current) => [{
        id: Date.now(),
        application_id: application.id,
        actor_id: profile?.id ?? null,
        action: decision === 'approve' ? 'approved' : 'rejected',
        reason: decision === 'reject' ? reason : null,
        created_at: updatedAt,
      }, ...current])
      if (decision === 'approve') {
        setVendor((current) => current ?? {
          ...demoVendorProfile,
          id: application.id,
          display_name: application.owner_name,
          is_active: true,
        })
      }
      setNotice(`Preview only: application ${decision}d in memory; no database access occurred.`)
      return
    }
    try {
      const client = requireSupabase()
      const { error: reviewError } = decision === 'approve'
        ? await client.rpc('approve_vendor_application', { p_application_id: application.id })
        : await client.rpc('reject_vendor_application', { p_application_id: application.id, p_reason: reason })
      if (reviewError) throw reviewError
      setNotice(translate('en', 'savedChanges'))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${decision} vendor application.`)
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!settings) return
    const form = new FormData(event.currentTarget)
    if (preview) {
      setSettings((current) => current ? {
        ...current,
        shop_name: String(form.get('shop_name') ?? '').trim(),
        address: String(form.get('address') ?? '').trim(),
        description: String(form.get('description') ?? '').trim(),
        is_active: form.get('is_active') === 'on',
        updated_at: new Date().toISOString(),
      } : current)
      setNotice('Preview only: settings are held in memory and were not saved to Supabase.')
      return
    }
    try {
      const { error: updateError } = await requireSupabase().from('shop_settings').update({
        shop_name: String(form.get('shop_name') ?? '').trim(),
        address: String(form.get('address') ?? '').trim(),
        description: String(form.get('description') ?? '').trim(),
        is_active: form.get('is_active') === 'on',
      }).eq('id', 1)
      if (updateError) throw updateError
      setNotice(translate('en', 'savedChanges'))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save shop settings.')
    }
  }

  async function uploadLogo(file: File) {
    if (!isValidImage(file)) {
      setError(translate('en', 'imageTypeError'))
      return
    }
    if (!settings) return
    if (preview) {
      setSettings((current) => current ? { ...current, logo_url: URL.createObjectURL(file) } : current)
      setNotice('Preview only: logo preview is not uploaded to Supabase.')
      return
    }
    try {
      const client = requireSupabase()
      const path = `shop/${crypto.randomUUID()}.${extensionFor(file.type)}`
      const { error: uploadError } = await client.storage.from('product-images').upload(path, file, { upsert: false, contentType: file.type })
      if (uploadError) throw uploadError
      const { data } = client.storage.from('product-images').getPublicUrl(path)
      const { error: updateError } = await client.from('shop_settings').update({ logo_url: data.publicUrl }).eq('id', 1)
      if (updateError) throw updateError
      setNotice(translate('en', 'savedChanges'))
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to upload logo.')
    }
  }

  const tabs: { key: DashboardTab; label: string; icon: typeof LayoutDashboard }[] = [
    { key: 'overview', label: translate('en', 'overview'), icon: LayoutDashboard },
    { key: 'products', label: translate('en', 'productsLabel'), icon: Boxes },
    { key: 'enquiries', label: translate('en', 'enquiries'), icon: MessageCircle },
    ...(isAdmin ? [{ key: 'vendors' as const, label: 'Vendor management', icon: Users }] : []),
    ...(isAdmin ? [{ key: 'settings' as const, label: translate('en', 'settings'), icon: Settings }] : []),
  ]

  return (
    <div className="staff-app">
      <aside className={menuOpen ? 'staff-sidebar menu-open' : 'staff-sidebar'}>
        <Link className="staff-brand" to="/"><span className="brand-mark"><Flame size={19} /></span><span>ANIL <b>CRACKERS</b><small>{isAdmin ? 'SUPER ADMIN' : 'VENDOR PORTAL'}</small></span></Link>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="staff-nav">
          {tabs.map(({ key, label, icon: Icon }) => <button key={key} className={tab === key ? 'staff-nav-item active' : 'staff-nav-item'} onClick={() => { setTab(key); setMenuOpen(false) }}><Icon size={18} />{label}{key === 'enquiries' && enquiries.filter((item) => item.status === 'new').length > 0 ? <span className="nav-count">{enquiries.filter((item) => item.status === 'new').length}</span> : null}</button>)}
        </nav>
        {import.meta.env.DEV ? <div className="staff-dev-portals"><span>PORTAL PREVIEW</span><DevConfigNotice /><DevPortalLinks activeRole={role} /></div> : null}
        <div className="sidebar-bottom">
          <div className="staff-profile"><span className="avatar">{(profile?.display_name || (isAdmin ? 'A' : 'V')).slice(0, 1).toUpperCase()}</span><span><strong>{profile?.display_name || (isAdmin ? 'Super Admin' : 'Vendor')}</strong><small>{isAdmin ? 'Platform owner' : 'Shop manager'}</small></span></div>
          <button className="signout-button" onClick={() => void signOut()}><LogOut size={17} />{translate('en', 'signOut')}</button>
        </div>
      </aside>
      <div className="staff-main">
        <header className="staff-topbar">
          <button className="mobile-menu icon-button" aria-label="Toggle navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div><span className="eyebrow">{translate('en', 'platformArea')}</span><h1>{isAdmin ? 'Super Admin Dashboard' : 'Vendor Dashboard'}</h1>{preview ? <p className="preview-notice">DEVELOPMENT PREVIEW · SAMPLE DATA · NO DATABASE ACCESS</p> : null}</div>
          <Link className="button button-outline" to="/">View customer site <ArrowUpRight size={15} /></Link>
        </header>
        <main className="dashboard-content">
          {error ? <div className="dashboard-alert error-message" role="alert"><CircleAlert size={17} />{error}<button onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div> : null}
          {notice ? <div className="dashboard-alert success-alert" role="status"><Check size={17} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss message"><X size={16} /></button></div> : null}
          {loading ? <div className="dashboard-loading"><span className="spinner" />Loading dashboard…</div> : (
            <>
              {tab === 'overview' ? <Overview role={role} preview={preview} products={products} enquiries={enquiries} settings={settings} vendor={vendor} onToggleVendor={() => void toggleVendor()} onNavigate={setTab} /> : null}
              {tab === 'products' ? <ProductsPanel products={products} canManageProducts={!isAdmin} onAdd={() => setEditingProduct('new')} onEdit={setEditingProduct} onToggle={(product) => void updateProduct(product, { is_active: !product.is_active })} onDelete={(product) => void deleteProduct(product)} /> : null}
              {tab === 'enquiries' ? <EnquiriesPanel enquiries={enquiries} onStatusChange={(enquiry, status) => void updateEnquiryStatus(enquiry, status)} /> : null}
              {tab === 'vendors' && isAdmin ? <VendorManagement applications={applications} events={applicationEvents} onReview={(application, decision, reason) => void reviewApplication(application, decision, reason)} onSetAccess={(target, active) => void changeVendorAccess(target, active)} /> : null}
              {tab === 'settings' && isAdmin ? <SettingsPanel settings={settings} vendor={vendor} preview={preview} onSubmit={(event) => void saveSettings(event)} onToggleVendor={() => void toggleVendor()} onLogo={uploadLogo} /> : null}
            </>
          )}
        </main>
      </div>
      {editingProduct !== null ? <ProductEditor product={editingProduct === 'new' ? null : editingProduct} ownerId={profile?.id ?? demoVendorProfile.id} preview={preview} onClose={() => setEditingProduct(null)} onSaved={async (values) => {
        if (preview && values) {
          const timestamp = new Date().toISOString()
          if (editingProduct === 'new') {
            setProducts((current) => [...current, { ...values, id: crypto.randomUUID(), created_at: timestamp, updated_at: timestamp }])
          } else {
            setProducts((current) => current.map((item) => item.id === editingProduct.id ? { ...item, ...values, updated_at: timestamp } : item))
          }
          setNotice('Preview only: product changes are held in memory, were not saved to Supabase and will not appear in the customer catalogue.')
        } else {
          await reload()
          setNotice(translate('en', 'savedChanges'))
        }
        setEditingProduct(null)
      }} /> : null}
    </div>
  )
}

function Overview({ role, preview, products, enquiries, settings, vendor, onToggleVendor, onNavigate }: {
  role: UserRole
  preview: boolean
  products: Product[]
  enquiries: EnquiryWithItems[]
  settings: ShopSettings | null
  vendor: Profile | null
  onToggleVendor: () => void
  onNavigate: (tab: DashboardTab) => void
}) {
  const active = products.filter((product) => product.is_active).length
  const fresh = enquiries.filter((enquiry) => enquiry.status === 'new').length
  const recentProducts = [...products]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 4)
  return (
    <div className="dashboard-page">
      <div className="dashboard-heading"><div><span className="eyebrow">{translate('en', 'welcomeBack')}</span><h2>{role === 'superadmin' ? 'A clear view of your shop.' : 'Your shop, at a glance.'}</h2><p>Keep the catalogue fresh and respond to customer interest.</p></div><div className={`shop-status ${!settings ? 'unknown' : settings.is_active ? 'online' : 'offline'}`}><span />{!settings ? 'Shop status unavailable' : settings.is_active ? 'Shop is live' : 'Shop is paused'}</div></div>
      <div className="stat-grid">
        <StatCard label={translate('en', 'totalProducts')} value={products.length} icon={Package} accent="gold" />
        <StatCard label={translate('en', 'activeProducts')} value={active} icon={Check} accent="green" />
        <StatCard label={translate('en', 'inactiveProducts')} value={products.length - active} icon={Boxes} accent="slate" />
        <StatCard label={translate('en', 'newEnquiries')} value={fresh} icon={MessageCircle} accent="rose" />
        <StatCard label={translate('en', 'totalEnquiries')} value={enquiries.length} icon={MessageCircle} accent="rose" />
      </div>
      <div className="dashboard-columns">
        <section className="dashboard-card">
          <div className="card-heading"><div><h3>{translate('en', 'recentEnquiries')}</h3><p>Latest customer interest</p></div><button className="text-button" onClick={() => onNavigate('enquiries')}>View all <ArrowRight size={14} /></button></div>
          {enquiries.slice(0, 5).length ? <div className="recent-list">{enquiries.slice(0, 5).map((enquiry) => <div className="recent-row" key={enquiry.id}><span className="recent-avatar">{enquiry.customer_name.slice(0, 1).toUpperCase()}</span><span className="recent-main"><strong>{enquiry.customer_name}</strong><small>{enquiry.reference_code} · {enquiry.items.length} {enquiry.items.length === 1 ? 'item' : 'items'}</small></span><StatusBadge status={enquiry.status} /><span className="recent-date">{formatDate(enquiry.created_at)}</span></div>)}</div> : <EmptyState text={translate('en', 'noEnquiries')} />}
        </section>
        <section className="dashboard-card">
          <div className="card-heading"><div><h3>{translate('en', 'recentProducts')}</h3><p>Your latest catalogue updates</p></div><button className="text-button" onClick={() => onNavigate('products')}>Manage <ArrowRight size={14} /></button></div>
          {recentProducts.length ? <div className="product-mini-list">{recentProducts.map((product) => <div className="product-mini" key={product.id}><img src={productImageSrc(product.image_url)} onError={applyImageFallback} alt="" /><span><strong>{product.name_en}</strong><small>{product.category}</small></span><span className={product.is_active ? 'mini-state active' : 'mini-state'}>{product.is_active ? 'Active' : 'Inactive'}</span></div>)}</div> : <EmptyState text="No products added yet." />}
        </section>
      </div>
      {role === 'superadmin' ? <div className="admin-overview-row">
        <section className="dashboard-card admin-status-card"><span className="status-icon"><Users size={20} /></span><div><h3>{translate('en', 'vendorAccount')}</h3><p>{vendor?.display_name || translate('en', 'noVendor')}</p></div>{vendor ? <><span className={vendor.is_active ? 'mini-state active' : 'mini-state'}>{vendor.is_active ? 'Active' : 'Disabled'}</span><button className="button button-outline" onClick={onToggleVendor}>{vendor.is_active ? 'Disable access' : 'Enable access'}</button></> : null}</section>
        <section className="dashboard-card platform-health"><span className="status-icon green"><ShieldCheck size={20} /></span><div><h3>{translate('en', 'platformHealth')}</h3><p>{preview ? 'Development preview · no database connection' : `${translate('en', 'connected')} · Staff account verified`}</p></div><span className={preview ? 'health-dot disabled' : 'health-dot'} /></section>
      </div> : null}
      <p className="privacy-footnote"><ShieldCheck size={14} />{translate('en', 'customerPrivacy')}</p>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: number; icon: typeof Package; accent: string }) {
  return <article className="stat-card"><span className={`stat-icon ${accent}`}><Icon size={19} /></span><span className="stat-label">{label}</span><strong>{value}</strong><span className="stat-trend"><Clock3 size={12} /> Current shop data</span></article>
}

function VendorManagement({ applications, events, onReview, onSetAccess }: {
  applications: VendorApplication[]
  events: VendorApplicationEvent[]
  onReview: (application: VendorApplication, decision: 'approve' | 'reject', reason?: string) => void
  onSetAccess: (vendor: VendorApplication, active: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | VendorApplication['status']>('all')
  const [rejectingApplicationId, setRejectingApplicationId] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [rejectionError, setRejectionError] = useState('')
  const counts = {
    all: applications.length,
    pending: applications.filter((app) => app.status === 'pending').length,
    approved: applications.filter((app) => app.status === 'approved').length,
    rejected: applications.filter((app) => app.status === 'rejected').length,
    suspended: applications.filter((app) => app.status === 'suspended').length,
  }
  const needle = query.trim().toLocaleLowerCase()
  const visible = applications.filter((application) => {
    const matchesStatus = filter === 'all' || application.status === filter
    const matchesText = !needle || [
      application.business_name,
      application.owner_name,
      application.phone,
      application.email,
      application.location,
    ].some((value) => value.toLocaleLowerCase().includes(needle))
    return matchesStatus && matchesText
  })

  function reject(application: VendorApplication) {
    const reason = rejectionReason.trim()
    if (reason.length < 2 || reason.length > 1000) {
      setRejectionError('Enter a rejection reason between 2 and 1000 characters.')
      return
    }
    onReview(application, 'reject', reason)
    setRejectingApplicationId(null)
    setRejectionReason('')
    setRejectionError('')
  }

  return (
    <section className="dashboard-page">
      <div className="dashboard-heading"><div><span className="eyebrow">ACCESS AND APPROVALS</span><h2>Vendor management</h2><p>Review applications and manage approved vendor access.</p></div><span className="privacy-badge"><ShieldCheck size={15} /> Super Admin only</span></div>
      <div className="vendor-count-grid">
        {([
          ['Total', counts.all],
          ['Pending', counts.pending],
          ['Approved', counts.approved],
          ['Rejected', counts.rejected],
          ['Suspended', counts.suspended],
        ] as const).map(([label, count]) => <article className="vendor-count-card" key={label}><span>{label}</span><strong>{count}</strong></article>)}
      </div>
      <div className="vendor-toolbar">
        <label className="search-field"><Search size={17} /><input placeholder="Search business, owner, phone, email or location" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="select-field"><span>Status</span><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All statuses</option>{(['pending', 'approved', 'rejected', 'suspended'] as const).map((status) => <option value={status} key={status}>{status}</option>)}</select><ChevronDown size={15} /></label>
      </div>
      {visible.length ? <div className="vendor-application-list">{visible.map((application) => {
        const latestEvent = events.find((event) => event.application_id === application.id)
        const assignedProfile = application.status === 'approved' || application.status === 'suspended' ? application : null
        return <article className="vendor-application-item" key={application.id}>
          <div className="vendor-application-heading"><div><span className="eyebrow">VENDOR APPLICATION</span><h3>{application.business_name}</h3><p>{application.owner_name} · {application.location}</p></div><span className={`vendor-status vendor-status-${application.status}`}>{application.status}</span></div>
          <div className="vendor-application-details">
            <span><strong>Phone</strong><a href={`tel:${application.phone}`}>{application.phone || 'Not provided'}</a></span>
            <span><strong>Email</strong><a href={`mailto:${application.email}`}>{application.email || 'Not provided'}</a></span>
            <span><strong>Registered</strong>{formatDate(application.submitted_at, true)}</span>
            <span><strong>{application.reviewed_at ? 'Reviewed' : 'Approval date'}</strong>{application.reviewed_at ? formatDate(application.reviewed_at, true) : application.status === 'pending' ? 'Pending' : 'Not recorded'}</span>
          </div>
          {application.rejection_reason ? <p className="application-rejection">Rejection reason: {application.rejection_reason}</p> : null}
          {application.reviewed_by ? <p className="application-audit">Reviewed by administrator account {application.reviewed_by}</p> : null}
          {latestEvent ? <p className="application-audit">Latest recorded action: {latestEvent.action}{latestEvent.actor_id ? ` · administrator ${latestEvent.actor_id}` : ''} · {formatDate(latestEvent.created_at, true)}</p> : null}
          <div className="vendor-application-actions">
            {application.status === 'pending' ? <>
              <button className="button button-primary" onClick={() => onReview(application, 'approve')}><Check size={15} /> Approve</button>
              <button className="button button-danger-outline" onClick={() => {
                setRejectingApplicationId(application.id)
                setRejectionReason('')
                setRejectionError('')
              }}>Reject</button>
            </> : null}
            {application.status === 'approved' && assignedProfile ? <button className="button button-danger-outline" onClick={() => onSetAccess(assignedProfile, false)}>Suspend vendor</button> : null}
            {application.status === 'suspended' && assignedProfile ? <button className="button button-outline" onClick={() => onSetAccess(assignedProfile, true)}>Reactivate vendor</button> : null}
          </div>
          {rejectingApplicationId === application.id ? <form className="vendor-rejection-form" onSubmit={(event) => {
            event.preventDefault()
            reject(application)
          }}>
            <label className="field-label">Rejection reason
              <textarea aria-describedby={rejectionError ? 'vendor-rejection-error' : undefined} aria-invalid={Boolean(rejectionError)} maxLength={1000} rows={3} value={rejectionReason} onChange={(event) => {
                setRejectionReason(event.target.value)
                setRejectionError('')
              }} />
            </label>
            {rejectionError ? <p className="error-message" id="vendor-rejection-error" role="alert">{rejectionError}</p> : null}
            <div className="vendor-application-actions">
              <button className="button button-primary" type="submit">Confirm rejection</button>
              <button className="button button-outline" type="button" onClick={() => {
                setRejectingApplicationId(null)
                setRejectionReason('')
                setRejectionError('')
              }}>Cancel</button>
            </div>
          </form> : null}
        </article>
      })}</div> : <div className="dashboard-card"><EmptyState text={applications.length ? 'No vendor applications match these filters.' : 'No vendor applications have been received.'} /></div>}
    </section>
  )
}

function ProductsPanel({ products, canManageProducts, onAdd, onEdit, onToggle, onDelete }: {
  products: Product[]
  canManageProducts: boolean
  onAdd: () => void
  onEdit: (product: Product) => void
  onToggle: (product: Product) => void
  onDelete: (product: Product) => void
}) {
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [stockFilter, setStockFilter] = useState<'all' | StockStatus>('all')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const visible = products.filter((product) => {
    const matchesActive = filter === 'all' || (filter === 'active' ? product.is_active : !product.is_active)
    const matchesStock = stockFilter === 'all' || getStockStatus(product.stock_quantity, product.low_stock_threshold) === stockFilter
    const matchesText = !needle || [product.name_en, product.name_kn, product.category].some((value) => value.toLocaleLowerCase().includes(needle))
    return matchesActive && matchesStock && matchesText
  })
  return (
    <section className="dashboard-page">
      <div className="dashboard-heading"><div><span className="eyebrow">CATALOGUE MANAGEMENT</span><h2>Products</h2><p>{canManageProducts ? 'Manage catalogue, available stock and low-stock alerts.' : 'Review catalogue details and manage product visibility.'}</p></div>{canManageProducts ? <button className="button button-primary" onClick={onAdd}><Plus size={17} /> Add product</button> : null}</div>
      <div className="panel-toolbar">
        <div className="segmented-control">{(['all', 'active', 'inactive'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? `All (${products.length})` : value === 'active' ? `Active (${products.filter((item) => item.is_active).length})` : `Inactive (${products.filter((item) => !item.is_active).length})`}</button>)}</div>
        <span className="table-count">{visible.length} products</span>
      </div>
      <div className="stock-toolbar">
        <label className="search-field"><Search size={16} /><input aria-label="Search products" placeholder="Search products" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="select-field"><span>Stock</span><select value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}><option value="all">All stock</option><option value="in-stock">In stock</option><option value="low-stock">Low stock</option><option value="out-of-stock">Out of stock</option></select><ChevronDown size={15} /></label>
      </div>
      {visible.length ? <div className="manage-product-grid">{visible.map((product) => <article className="manage-product-card" key={product.id}>
        <div className="manage-product-image"><img src={productImageSrc(product.image_url)} onError={applyImageFallback} alt="" loading="lazy" /><span className={product.is_active ? 'mini-state active' : 'mini-state'}>{product.is_active ? 'Active' : 'Inactive'}</span></div>
        <div className="manage-product-info"><span className="product-category admin-category">{product.category}</span><h3>{product.name_en}</h3><p className="kn-subtitle">{product.name_kn}</p><div className="manage-prices">{product.selling_price !== null ? <strong>{formatPrice(product.selling_price)}</strong> : <span>No display price</span>}{product.mrp !== null ? <del>{formatPrice(product.mrp)}</del> : null}</div><div className="stock-management-row"><span className={`stock-badge stock-${getStockStatus(product.stock_quantity, product.low_stock_threshold)}`}>{stockStatusLabel(getStockStatus(product.stock_quantity, product.low_stock_threshold))}</span><strong>{product.stock_quantity} available</strong><small>Alert at {product.low_stock_threshold}</small></div><div className="manage-product-actions">{canManageProducts ? <button className="button button-outline" onClick={() => onEdit(product)}>Edit</button> : null}<button className="button button-outline" title={product.is_active ? 'Deactivate' : 'Activate'} onClick={() => onToggle(product)}>{product.is_active ? 'Deactivate' : 'Activate'}</button>{canManageProducts ? <button className="icon-button danger-icon" title="Delete product" onClick={() => onDelete(product)}><Trash2 size={16} /></button> : null}</div></div>
      </article>)}</div> : <div className="dashboard-card"><EmptyState text="No products in this view." /></div>}
    </section>
  )
}

function stockStatusLabel(status: StockStatus) {
  if (status === 'in-stock') return 'In stock'
  if (status === 'low-stock') return 'Low stock'
  return 'Out of stock'
}

function EnquiriesPanel({ enquiries, onStatusChange }: { enquiries: EnquiryWithItems[]; onStatusChange: (enquiry: Enquiry, status: EnquiryStatus) => void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [date, setDate] = useState('')
  const filtered = enquiries.filter((enquiry) => {
    const matchesStatus = status === 'all' || enquiry.status === status
    const matchesDate = !date || localDateValue(enquiry.created_at) === date
    const searchText = `${enquiry.customer_name} ${enquiry.customer_phone} ${enquiry.reference_code}`.toLowerCase()
    return matchesStatus && matchesDate && searchText.includes(search.toLowerCase())
  })
  return (
    <section className="dashboard-page">
      <div className="dashboard-heading"><div><span className="eyebrow">CUSTOMER INTEREST</span><h2>Enquiries</h2><p>Track customer interest and follow up directly.</p></div><span className="privacy-badge"><ShieldCheck size={15} /> Private to staff</span></div>
      <div className="enquiry-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Search name, phone or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="select-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option value={item} key={item}>{statusLabel(item)}</option>)}</select><ChevronDown size={15} /></label><label className="select-field date-field"><span>Date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>
      {filtered.length ? <div className="enquiry-list">{filtered.map((enquiry) => <article className="enquiry-card" key={enquiry.id}>
        <div className="enquiry-card-top"><div className="enquiry-customer"><span className="recent-avatar large-avatar">{enquiry.customer_name.slice(0, 1).toUpperCase()}</span><div><h3>{enquiry.customer_name}</h3><p>{enquiry.reference_code} <span>·</span> {formatDate(enquiry.created_at, true)}</p></div></div><StatusBadge status={enquiry.status} /></div>
        <div className="enquiry-contact"><a href={`tel:${enquiry.customer_phone}`}><span className="contact-icon"><Clock3 size={15} /></span>{enquiry.customer_phone}</a><a href={`https://wa.me/${enquiry.customer_phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a></div>
        <div className="enquiry-items"><span className="field-caption">{translate('en', 'items')}</span>{enquiry.items.length ? enquiry.items.map((item) => <div className="enquiry-item-row" key={item.id}><span>{item.product_name_snapshot}</span><span>× {item.quantity}</span><span>{item.selling_price_snapshot === null ? 'Price not set' : formatPrice(item.selling_price_snapshot)}</span></div>) : <span className="muted-copy">No product details</span>}</div>
        <label className="status-control"><span>Internal status</span><select value={enquiry.status} onChange={(event) => onStatusChange(enquiry, event.target.value as EnquiryStatus)}>{statuses.map((item) => <option value={item} key={item}>{statusLabel(item)}</option>)}</select><ChevronDown size={14} /></label>
      </article>)}</div> : <div className="dashboard-card"><EmptyState text={enquiries.length ? 'No enquiries match these filters.' : translate('en', 'noEnquiries')} /></div>}
      <p className="privacy-footnote"><ShieldCheck size={14} />Enquiry statuses are internal tracking only, not order or payment statuses.</p>
    </section>
  )
}

function SettingsPanel({ settings, vendor, preview, onSubmit, onToggleVendor, onLogo }: {
  settings: ShopSettings | null
  vendor: Profile | null
  preview: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onToggleVendor: () => void
  onLogo: (file: File) => void
}) {
  if (!settings) return <div className="dashboard-card"><EmptyState text="Shop settings are not initialized. Run the Supabase migration and insert the initial shop record." /></div>
  return (
    <section className="dashboard-page">
      <div className="dashboard-heading"><div><span className="eyebrow">PLATFORM CONFIGURATION</span><h2>Shop settings</h2><p>Control the public shop details and access.</p></div><span className="privacy-badge"><ShieldCheck size={15} /> Super Admin only</span></div>
      <div className="settings-layout">
        <form className="dashboard-card settings-form" onSubmit={onSubmit}>
          <div className="card-heading"><div><h3>Public shop profile</h3><p>Details shown on the customer website.</p></div></div>
          <div className="logo-upload-row">
            {settings.logo_url ? <img src={settings.logo_url} alt="Shop logo" className="shop-logo-preview" /> : <span className="shop-logo-placeholder"><Flame size={23} /></span>}
            <div><strong>Shop logo</strong><small>Square image recommended · up to 5 MB</small>
              <label className="button button-outline upload-trigger"><ImagePlus size={15} /> Upload logo<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onLogo(file)
                event.currentTarget.value = ''
              }} /></label>
            </div>
          </div>
          <FormField name="shop_name" label={translate('en', 'shopName')} defaultValue={settings.shop_name} required />
          <FormField name="address" label={translate('en', 'address')} defaultValue={settings.address} />
          <label className="field-label">{translate('en', 'description')}<textarea name="description" rows={4} defaultValue={settings.description} /></label>
          <label className="checkbox-field"><input type="checkbox" name="is_active" defaultChecked={settings.is_active} /><span><strong>{translate('en', 'shopActive')}</strong><small>When paused, the customer catalogue will not be available.</small></span></label>
          <button className="button button-primary" type="submit"><Check size={16} />{translate('en', 'save')}</button>
        </form>
        <div className="settings-side">
          <section className="dashboard-card vendor-access-card"><div className="card-heading"><div><h3>{translate('en', 'vendorAccess')}</h3><p>Manage Anil’s account access.</p></div><Users size={19} /></div>
            {vendor ? <><div className="vendor-profile-row"><span className="avatar">{(vendor.display_name || 'A').slice(0, 1).toUpperCase()}</span><span><strong>{vendor.display_name || 'Vendor account'}</strong><small>Assigned vendor</small></span></div><div className="vendor-access-state"><span className={vendor.is_active ? 'health-dot' : 'health-dot disabled'} />{vendor.is_active ? 'Access enabled' : 'Access disabled'}</div><button className={vendor.is_active ? 'button button-danger-outline' : 'button button-primary'} onClick={onToggleVendor}>{vendor.is_active ? 'Disable vendor access' : 'Enable vendor access'}</button></> : <EmptyState text={translate('en', 'noVendor')} />}
          </section>
          <section className="dashboard-card security-note"><ShieldCheck size={20} /><div><h3>{preview ? 'Preview mode — no account access is changed' : 'Access is enforced by the database'}</h3><p>{preview ? 'These controls modify only sample values in memory. No account, storage or database operation is performed.' : 'Role and active-account checks are applied by Supabase Row Level Security for every request.'}</p></div></section>
        </div>
      </div>
    </section>
  )
}

function FormField({ name, label, defaultValue, required = false, type = 'text', min, step }: {
  name: string
  label: string
  defaultValue?: string | number | null
  required?: boolean
  type?: string
  min?: number
  step?: number
}) {
  return <label className="field-label">{label}<input name={name} type={type} defaultValue={defaultValue ?? ''} required={required} min={min} step={step} /></label>
}

type ProductWrite = Omit<Product, 'id' | 'created_at' | 'updated_at'>

function ProductEditor({ product, ownerId, preview, onClose, onSaved }: {
  product: Product | null
  ownerId: string
  preview: boolean
  onClose: () => void
  onSaved: (values: ProductWrite) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? '')
  const [active, setActive] = useState(product?.is_active ?? true)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSaving(true)
    const form = new FormData(event.currentTarget)
    const nameEn = String(form.get('name_en') ?? '').trim()
    const nameKn = String(form.get('name_kn') ?? '').trim()
    const category = String(form.get('category') ?? '')
    const mrp = parseOptionalPrice(String(form.get('mrp') ?? ''))
    const sellingPrice = parseOptionalPrice(String(form.get('selling_price') ?? ''))
    const stockQuantity = Number(form.get('stock_quantity'))
    const lowStockThreshold = Number(form.get('low_stock_threshold'))
    const sortOrder = Number(form.get('sort_order'))
    if (!nameEn || !nameKn || (mrp !== null && mrp < 0) || (sellingPrice !== null && sellingPrice < 0) || (mrp !== null && sellingPrice !== null && sellingPrice > mrp)) {
      setError('Enter both product names, valid non-negative prices, and a display price no higher than MRP.')
      setSaving(false)
      return
    }
    if (!isValidStockValue(stockQuantity) || !isValidStockValue(lowStockThreshold) || !isValidStockValue(sortOrder)) {
      setError('Stock, low-stock threshold, and display order must be non-negative whole numbers.')
      setSaving(false)
      return
    }
    try {
      let nextImageUrl = imageUrl || null
      const values: ProductWrite = {
        vendor_id: ownerId,
        name_en: nameEn,
        name_kn: nameKn,
        description_en: String(form.get('description_en') ?? '').trim(),
        description_kn: String(form.get('description_kn') ?? '').trim(),
        category,
        image_url: nextImageUrl,
        mrp,
        selling_price: sellingPrice,
        stock_quantity: stockQuantity,
        low_stock_threshold: lowStockThreshold,
        is_active: active,
        sort_order: sortOrder,
      }
      if (preview) {
        await onSaved(values)
        return
      }

      const client = requireSupabase()
      let uploadedPath = ''
      if (imageFile) {
        uploadedPath = `products/${ownerId}/${crypto.randomUUID()}.${extensionFor(imageFile.type)}`
        const { error: uploadError } = await client.storage.from('product-images').upload(uploadedPath, imageFile, { upsert: false, contentType: imageFile.type })
        if (uploadError) throw uploadError
        nextImageUrl = client.storage.from('product-images').getPublicUrl(uploadedPath).data.publicUrl
        values.image_url = nextImageUrl
      }
      const result = product
        ? await client.from('products').update(values).eq('id', product.id)
        : await client.from('products').insert({ ...values, id: crypto.randomUUID() })
      if (result.error) {
        if (uploadedPath) {
          const { error: cleanupError } = await client.storage.from('product-images').remove([uploadedPath])
          if (cleanupError) throw new Error(`${result.error.message}. Uploaded image cleanup failed: ${cleanupError.message}`)
        }
        throw result.error
      }
      if (product?.image_url && imageFile) {
        const previousPath = storagePathFromPublicUrl(product.image_url)
        if (previousPath && isOwnedVendorImagePath(previousPath, ownerId)) {
          const { error: removeError } = await client.storage.from('product-images').remove([previousPath])
          if (removeError) throw new Error(`Product saved, but old image cleanup failed: ${removeError.message}`)
        }
      }
      await onSaved(values)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save product.')
    } finally {
      setSaving(false)
    }
  }

  function selectImage(file?: File) {
    if (!file) return
    if (!isValidImage(file)) {
      setError(translate('en', 'imageTypeError'))
      return
    }
    setError('')
    setImageFile(file)
    setImageUrl(URL.createObjectURL(file))
  }

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="product-editor-modal" role="dialog" aria-modal="true" aria-labelledby="product-editor-title">
        <div className="modal-header"><div><span className="eyebrow">CATALOGUE</span><h2 id="product-editor-title">{product ? 'Edit product' : 'Add product'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>
        <form className="product-editor-form" onSubmit={(event) => void submit(event)}>
          <div className="editor-image-row">
            <img className="editor-image-preview" src={productImageSrc(imageUrl)} onError={applyImageFallback} alt="" />
            <label className="button button-outline upload-trigger"><ImagePlus size={16} />{translate('en', 'uploadImage')}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(event) => {
              selectImage(event.target.files?.[0])
              event.currentTarget.value = ''
            }} /></label>
            <span>{translate('en', 'imageHelp')}</span>
          </div>
          <div className="editor-fields">
            <FormField name="name_en" label={translate('en', 'nameEnglish')} defaultValue={product?.name_en} required />
            <FormField name="name_kn" label={translate('en', 'nameKannada')} defaultValue={product?.name_kn} required />
            <label className="field-label">{translate('en', 'descriptionEnglish')}<textarea name="description_en" rows={2} defaultValue={product?.description_en ?? ''} /></label>
            <label className="field-label">{translate('en', 'descriptionKannada')}<textarea name="description_kn" rows={2} defaultValue={product?.description_kn ?? ''} /></label>
            <label className="field-label">{translate('en', 'category')}<select name="category" defaultValue={product?.category ?? 'Ground'}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <FormField name="sort_order" label={translate('en', 'sortOrder')} type="number" defaultValue={product?.sort_order ?? 0} min={0} step={1} />
            <FormField name="stock_quantity" label="Available stock quantity" type="number" defaultValue={product?.stock_quantity ?? 0} min={0} step={1} required />
            <FormField name="low_stock_threshold" label="Low-stock alert threshold" type="number" defaultValue={product?.low_stock_threshold ?? 5} min={0} step={1} required />
            <FormField name="mrp" label={translate('en', 'mrpOptional')} type="number" defaultValue={product?.mrp} min={0} step={1} />
            <FormField name="selling_price" label={translate('en', 'sellingPrice')} type="number" defaultValue={product?.selling_price} min={0} step={1} />
          </div>
          <label className="checkbox-field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span><strong>{translate('en', 'isActive')}</strong><small>Inactive products are hidden from customers.</small></span></label>
          {error ? <p className="form-error" role="alert"><CircleAlert size={16} />{error}</p> : null}
          <div className="modal-actions"><button className="button button-outline" type="button" onClick={onClose}>{translate('en', 'cancel')}</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? <span className="spinner spinner-dark" /> : <Check size={16} />}{translate('en', 'saveProduct')}</button></div>
        </form>
      </section>
    </div>
  )
}

function StatusBadge({ status }: { status: EnquiryStatus }) {
  return <span className={`status-badge status-${status}`}>{statusLabel(status)}</span>
}

function statusLabel(status: EnquiryStatus) {
  const key: Record<EnquiryStatus, TranslationKey> = { new: 'new', contacted: 'contacted', completed: 'completed', closed: 'closed' }
  return translate('en', key[status])
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state"><span><Package size={20} /></span><p>{text}</p></div>
}

function formatDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat('en-IN', includeTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short' }).format(new Date(value))
}

function localDateValue(value: string) {
  const date = new Date(value)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function parseOptionalPrice(value: string) {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function isValidImage(file: File) {
  return ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type) && file.size <= 5 * 1024 * 1024
}

function extensionFor(mimeType: string) {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' }
  return extensions[mimeType] ?? 'bin'
}

function storagePathFromPublicUrl(url: string) {
  const marker = '/storage/v1/object/public/product-images/'
  const start = url.indexOf(marker)
  return start < 0 ? null : decodeURIComponent(url.slice(start + marker.length))
}

function isOwnedVendorImagePath(path: string, ownerId: string) {
  return path.startsWith(`products/${ownerId}/`)
}

export default App
