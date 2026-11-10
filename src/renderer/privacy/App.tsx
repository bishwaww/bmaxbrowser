import privacy from '../../../docs/PRIVACY.md?raw'
import { Markdown } from './markdown'
import './privacy.css'

export function App() {
  return (
    <main className="policy">
      <Markdown source={privacy} />
    </main>
  )
}
